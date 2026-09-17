import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 5.1 (Production Readiness — automatic expiry) — regression
// tests for expireStaleBookings(): the query filter (PENDING_PROVIDER +
// availability.startTime already passed), that each stale booking is
// transitioned in its OWN transaction (one row's failure must not
// affect another's), and that capacity is only released when the
// booking actually held a slot.

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();
const executeRawMock = vi.fn();
const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();
const cancelRentalMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: (...args: unknown[]) => executeRawMock(...args),
      }),
  },
}));

vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

// Phase 3C Slice C3/E2 — the rental cancellation-sync primitive is called in-tx for a rental booking.
vi.mock("@/lib/offerings/rental/reservation/cancel-confirmed-daily-rental-reservations", () => ({
  cancelConfirmedDailyRentalReservations: (...args: unknown[]) => cancelRentalMock(...args),
}));

const { expireStaleBookings } = await import("./expire-stale-bookings");

afterEach(() => {
  findManyMock.mockReset();
  executeRawMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  cancelRentalMock.mockReset();
});

describe("expireStaleBookings", () => {
  it("queries PENDING_PROVIDER bookings whose slot started OR whose rental provider-response deadline passed", async () => {
    findManyMock.mockResolvedValue([]);

    await expireStaleBookings();

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        status: "PENDING_PROVIDER",
        OR: [{ availability: { startTime: { lte: expect.any(Date) } } }, { providerResponseDeadlineAt: { lte: expect.any(Date) } }],
      },
      select: { id: true, availabilityId: true, seats: true, providerResponseDeadlineAt: true },
    });
  });

  it("transitions each stale SLOT booking to EXPIRED, releases capacity, fires the hook, and no-ops the rental release", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-1", availabilityId: "slot-1", seats: 2, providerResponseDeadlineAt: null }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "booking-1", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(transitionBookingMock).toHaveBeenCalledWith(
      { bookingId: "booking-1", toStatus: "EXPIRED", actorType: "SYSTEM" },
      expect.anything()
    );
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    // The rental cancellation-sync runs in-tx (idempotent no-op for a slot booking).
    expect(cancelRentalMock).toHaveBeenCalledWith(expect.anything(), "booking-1", expect.any(Date));
    // Slot bookings still fire the lifecycle hook (existing notification behavior, unchanged).
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ bookingId: "booking-1", toStatus: "EXPIRED" });
    expect(result).toEqual({ expiredCount: 1, failedCount: 0 });
  });

  it("skips the capacity-release query when the booking has no linked Availability", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-2", availabilityId: null, seats: 1, providerResponseDeadlineAt: null }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "booking-2", toStatus: "EXPIRED" });

    await expireStaleBookings();

    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("isolates failures — one booking's transition error does not affect another's success", async () => {
    findManyMock.mockResolvedValue([
      { id: "booking-fail", availabilityId: "slot-1", seats: 1, providerResponseDeadlineAt: null },
      { id: "booking-ok", availabilityId: "slot-2", seats: 1, providerResponseDeadlineAt: null },
    ]);
    transitionBookingMock
      .mockRejectedValueOnce(new Error("invalid transition"))
      .mockResolvedValueOnce({ bookingId: "booking-ok", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(result).toEqual({ expiredCount: 1, failedCount: 1 });
    expect(dispatchLifecycleHookMock).toHaveBeenCalledTimes(1);
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ bookingId: "booking-ok", toStatus: "EXPIRED" });
  });

  // Phase 3C Slice C3/E2 — a rental PENDING_PROVIDER booking past its provider-response deadline
  // (slotless: availabilityId null, deadline non-null) expires and its CONFIRMED daily children are
  // cancelled IN-TX; no capacity release (no slot); NO lifecycle hook (rental notification deferred).
  it("expires a rental booking past its deadline: EXPIRED + daily children cancelled, no capacity release, no hook", async () => {
    findManyMock.mockResolvedValue([{ id: "rental-1", availabilityId: null, seats: 1, providerResponseDeadlineAt: new Date("2030-01-01T00:00:00Z") }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "rental-1", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(transitionBookingMock).toHaveBeenCalledWith({ bookingId: "rental-1", toStatus: "EXPIRED", actorType: "SYSTEM" }, expect.anything());
    expect(cancelRentalMock).toHaveBeenCalledWith(expect.anything(), "rental-1", expect.any(Date)); // in-tx release
    expect(executeRawMock).not.toHaveBeenCalled(); // slotless → no capacity SQL
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled(); // rental → notification deferred
    expect(result).toEqual({ expiredCount: 1, failedCount: 0 });
  });

  it("rolls back both the Booking transition and the child release when the rental release fails", async () => {
    findManyMock.mockResolvedValue([{ id: "rental-2", availabilityId: null, seats: 1, providerResponseDeadlineAt: new Date("2030-01-01T00:00:00Z") }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "rental-2", toStatus: "EXPIRED" });
    cancelRentalMock.mockRejectedValue(new Error("release failed")); // throws inside the tx → whole tx aborts

    const result = await expireStaleBookings();

    expect(result).toEqual({ expiredCount: 0, failedCount: 1 });
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });
});
