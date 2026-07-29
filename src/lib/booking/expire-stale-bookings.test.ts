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

const { expireStaleBookings } = await import("./expire-stale-bookings");

afterEach(() => {
  findManyMock.mockReset();
  executeRawMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
});

describe("expireStaleBookings", () => {
  it("queries only PENDING_PROVIDER bookings whose Availability slot has already started", async () => {
    findManyMock.mockResolvedValue([]);

    await expireStaleBookings();

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        status: "PENDING_PROVIDER",
        availability: { startTime: { lte: expect.any(Date) } },
      },
      select: { id: true, availabilityId: true, seats: true },
    });
  });

  it("transitions each stale booking to EXPIRED and releases its held capacity", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-1", availabilityId: "slot-1", seats: 2 }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "booking-1", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(transitionBookingMock).toHaveBeenCalledWith(
      { bookingId: "booking-1", toStatus: "EXPIRED", actorType: "SYSTEM" },
      expect.anything()
    );
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ bookingId: "booking-1", toStatus: "EXPIRED" });
    expect(result).toEqual({ expiredCount: 1, failedCount: 0 });
  });

  it("skips the capacity-release query when the booking has no linked Availability", async () => {
    findManyMock.mockResolvedValue([{ id: "booking-2", availabilityId: null, seats: 1 }]);
    transitionBookingMock.mockResolvedValue({ bookingId: "booking-2", toStatus: "EXPIRED" });

    await expireStaleBookings();

    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("isolates failures — one booking's transition error does not affect another's success", async () => {
    findManyMock.mockResolvedValue([
      { id: "booking-fail", availabilityId: "slot-1", seats: 1 },
      { id: "booking-ok", availabilityId: "slot-2", seats: 1 },
    ]);
    transitionBookingMock
      .mockRejectedValueOnce(new Error("invalid transition"))
      .mockResolvedValueOnce({ bookingId: "booking-ok", toStatus: "EXPIRED" });

    const result = await expireStaleBookings();

    expect(result).toEqual({ expiredCount: 1, failedCount: 1 });
    expect(dispatchLifecycleHookMock).toHaveBeenCalledTimes(1);
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ bookingId: "booking-ok", toStatus: "EXPIRED" });
  });
});
