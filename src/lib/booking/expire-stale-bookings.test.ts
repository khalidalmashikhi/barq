import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

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
  it("queries PENDING_PROVIDER bookings: slot-started OR (rental snapshot present AND deadline passed) — deadline alone is insufficient", async () => {
    findManyMock.mockResolvedValue([]);

    await expireStaleBookings();

    // Fail-closed: the rental arm ANDs an explicit non-null `rentalSnapshot` (SQL-NULL, i.e.
    // Prisma.DbNull, excluded) with the passed deadline — a stray deadline on a non-rental booking
    // can never be returned by this branch. `rentalSnapshot` is also fetched for classification.
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        status: "PENDING_PROVIDER",
        OR: [
          { availability: { startTime: { lte: expect.any(Date) } } },
          { rentalSnapshot: { not: Prisma.DbNull }, providerResponseDeadlineAt: { lte: expect.any(Date) } },
        ],
      },
      select: { id: true, availabilityId: true, seats: true, rentalSnapshot: true, providerResponseDeadlineAt: true },
    });

    // Explicit, unmissable assertion of the non-null rentalSnapshot requirement on the rental arm.
    const firstCallArg = findManyMock.mock.calls[0]?.[0] as { where: { OR: Array<Record<string, unknown>> } } | undefined;
    const rentalArm = firstCallArg?.where.OR.find((clause) => "rentalSnapshot" in clause);
    expect(rentalArm).toBeDefined();
    expect(rentalArm!.rentalSnapshot).toEqual({ not: Prisma.DbNull });
    expect(rentalArm!.providerResponseDeadlineAt).toEqual({ lte: expect.any(Date) });
  });

  it("transitions each stale SLOT booking to EXPIRED, releases capacity, fires the hook, and no-ops the rental release", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-1", availabilityId: "slot-1", seats: 2, rentalSnapshot: null, providerResponseDeadlineAt: null }]);
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
    findManyMock.mockResolvedValue([{ id: "booking-2", availabilityId: null, seats: 1, rentalSnapshot: null, providerResponseDeadlineAt: null }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "booking-2", toStatus: "EXPIRED" });

    await expireStaleBookings();

    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("isolates failures — one booking's transition error does not affect another's success", async () => {
    findManyMock.mockResolvedValue([
      { id: "booking-fail", availabilityId: "slot-1", seats: 1, rentalSnapshot: null, providerResponseDeadlineAt: null },
      { id: "booking-ok", availabilityId: "slot-2", seats: 1, rentalSnapshot: null, providerResponseDeadlineAt: null },
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
    findManyMock.mockResolvedValue([{ id: "rental-1", availabilityId: null, seats: 1, rentalSnapshot: { rentalOfferingId: "off-1", passengerCount: 2 }, providerResponseDeadlineAt: new Date("2030-01-01T00:00:00Z") }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "rental-1", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(transitionBookingMock).toHaveBeenCalledWith({ bookingId: "rental-1", toStatus: "EXPIRED", actorType: "SYSTEM" }, expect.anything());
    expect(cancelRentalMock).toHaveBeenCalledWith(expect.anything(), "rental-1", expect.any(Date)); // in-tx release
    expect(executeRawMock).not.toHaveBeenCalled(); // slotless → no capacity SQL
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled(); // rental → notification deferred
    expect(result).toEqual({ expiredCount: 1, failedCount: 0 });
  });

  it("rolls back both the Booking transition and the child release when the rental release fails", async () => {
    findManyMock.mockResolvedValue([{ id: "rental-2", availabilityId: null, seats: 1, rentalSnapshot: { rentalOfferingId: "off-2", passengerCount: 3 }, providerResponseDeadlineAt: new Date("2030-01-01T00:00:00Z") }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "rental-2", toStatus: "EXPIRED" });
    cancelRentalMock.mockRejectedValue(new Error("release failed")); // throws inside the tx → whole tx aborts

    const result = await expireStaleBookings();

    expect(result).toEqual({ expiredCount: 0, failedCount: 1 });
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  // FAIL-CLOSED regression — a NON-rental booking that carries a stray, expired providerResponseDeadlineAt
  // (a hypothetical import/manual-repair/future-feature bug) is NOT a rental. If such a row is matched at
  // all it can only be via the SLOT arm (its slot started), and it must be handled as a SLOT booking:
  // status/expiry follows slot rules and the lifecycle hook FIRES. The deadline alone never makes it rental,
  // so the rental release is only the idempotent no-op every slot booking already gets — no rental treatment.
  it("treats a non-rental slot booking with a stray expired deadline as a SLOT booking (deadline alone ≠ rental)", async () => {
    findManyMock.mockResolvedValue([
      { id: "slot-stray", availabilityId: "slot-9", seats: 2, rentalSnapshot: null, providerResponseDeadlineAt: new Date("2030-01-01T00:00:00Z") },
    ]);
    transitionBookingMock.mockResolvedValue({ bookingId: "slot-stray", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    // Classified as a SLOT booking (rentalSnapshot is null): capacity released + hook fires.
    expect(transitionBookingMock).toHaveBeenCalledWith({ bookingId: "slot-stray", toStatus: "EXPIRED", actorType: "SYSTEM" }, expect.anything());
    expect(executeRawMock).toHaveBeenCalledTimes(1); // has a slot → capacity release
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ bookingId: "slot-stray", toStatus: "EXPIRED" }); // slot → hook fires (NOT skipped as rental)
    // The rental release is the idempotent in-tx no-op (0 hold groups), identical to any slot booking —
    // it never receives rental-specific treatment on the basis of the stray deadline.
    expect(cancelRentalMock).toHaveBeenCalledWith(expect.anything(), "slot-stray", expect.any(Date));
    expect(result).toEqual({ expiredCount: 1, failedCount: 0 });
  });
});
