import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.1 — regression tests for transitionBooking(), the single
// engine every status change must pass through: rejects a missing
// booking, rejects an invalid transition (and, critically, performs no
// write when it does), and on a valid transition writes the new
// status, sets confirmedAt only when transitioning to CONFIRMED (no
// other transition should touch that column), records exactly one
// BookingStatusEvent with the correct from/to/actor fields, and
// returns the context transitionBookingAndFireHooks needs to fire the
// lifecycle hook afterward.

vi.mock("server-only", () => ({}));

const findUniqueMock = vi.fn();
const updateManyMock = vi.fn();
const createEventMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
    bookingStatusEvent: {
      create: (...args: unknown[]) => createEventMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const dispatchLifecycleHookMock = vi.fn();
vi.mock("./hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks")>();
  return { ...actual, dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args) };
});

const { transitionBooking, transitionBookingAndFireHooks } = await import("./transition-booking");
const { BookingNotFoundError, InvalidBookingTransitionError, ConcurrentBookingModificationError } = await import(
  "./errors"
);

const BOOKING_ROW = {
  id: "booking-1",
  status: "CREATED" as const,
  customerId: "customer-1",
  providerId: "provider-1",
  serviceId: "service-1",
};

afterEach(() => {
  findUniqueMock.mockReset();
  updateManyMock.mockReset();
  createEventMock.mockReset();
  transactionMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
});

describe("transitionBooking", () => {
  it("throws BookingNotFoundError when the booking does not exist, without writing anything", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      transitionBooking({ bookingId: "missing", toStatus: "CONFIRMED", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(BookingNotFoundError);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("throws InvalidBookingTransitionError for a disallowed transition, without writing anything", async () => {
    findUniqueMock.mockResolvedValue(BOOKING_ROW);

    await expect(
      transitionBooking({ bookingId: "booking-1", toStatus: "IN_PROGRESS", actorType: "CUSTOMER" })
    ).rejects.toBeInstanceOf(InvalidBookingTransitionError);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("writes status + confirmedAt and one BookingStatusEvent on a valid transition to CONFIRMED", async () => {
    // Phase 4.1: CONFIRMED is now only reachable from PENDING_PROVIDER
    // (not directly from CREATED) — see transitions.ts's new matrix.
    findUniqueMock.mockResolvedValue({ ...BOOKING_ROW, status: "PENDING_PROVIDER" });
    updateManyMock.mockResolvedValue({ count: 1 });
    createEventMock.mockResolvedValue({});

    const ctx = await transitionBooking({
      bookingId: "booking-1",
      toStatus: "CONFIRMED",
      actorType: "PROVIDER",
      actorId: "provider-1",
    });

    // Production Blocker fix — the write is now a GUARDED updateMany():
    // the where clause re-asserts the exact status just read
    // (PENDING_PROVIDER), not just the booking id, so a concurrent
    // modification between the read and this write cannot silently
    // overwrite a status some other transaction already changed.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "PENDING_PROVIDER" },
      data: { status: "CONFIRMED", confirmedAt: expect.any(Date) },
    });

    expect(createEventMock).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        fromStatus: "PENDING_PROVIDER",
        toStatus: "CONFIRMED",
        actorType: "PROVIDER",
        actorId: "provider-1",
        reason: null,
      },
    });

    expect(ctx).toEqual({
      bookingId: "booking-1",
      customerId: "customer-1",
      providerId: "provider-1",
      serviceId: "service-1",
      fromStatus: "PENDING_PROVIDER",
      toStatus: "CONFIRMED",
    });
  });

  it("does not set confirmedAt for a transition that isn't to CONFIRMED", async () => {
    findUniqueMock.mockResolvedValue({ ...BOOKING_ROW, status: "CONFIRMED" });
    updateManyMock.mockResolvedValue({ count: 1 });
    createEventMock.mockResolvedValue({});

    await transitionBooking({ bookingId: "booking-1", toStatus: "IN_PROGRESS", actorType: "SYSTEM" });

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "CONFIRMED" },
      data: { status: "IN_PROGRESS" },
    });
  });

  // Production Blocker fix — regression coverage for the exact race this
  // guard closes: a concurrent transaction changed the booking's status
  // between our read and our write (simulated here by the guarded
  // updateMany() affecting 0 rows, exactly what Postgres would report
  // if another transaction's own guarded update already won the race).
  describe("concurrent modification (Production Blocker fix)", () => {
    it("throws ConcurrentBookingModificationError when the guarded update affects zero rows, without recording a BookingStatusEvent", async () => {
      findUniqueMock.mockResolvedValue({ ...BOOKING_ROW, status: "PENDING_PROVIDER" });
      updateManyMock.mockResolvedValue({ count: 0 });

      const error = await transitionBooking({
        bookingId: "booking-1",
        toStatus: "CONFIRMED",
        actorType: "PROVIDER",
      }).catch((e) => e);

      expect(error).toBeInstanceOf(ConcurrentBookingModificationError);
      expect((error as InstanceType<typeof ConcurrentBookingModificationError>).bookingId).toBe("booking-1");
      // The guard must fail BEFORE any BookingStatusEvent is recorded —
      // otherwise a lost-race transition would still leave a false
      // audit trail entry claiming it succeeded.
      expect(createEventMock).not.toHaveBeenCalled();
    });

    it("guards on the exact status just read, not merely the booking id — two different concurrent reads produce two different where clauses", async () => {
      findUniqueMock.mockResolvedValueOnce({ ...BOOKING_ROW, status: "PENDING_PROVIDER" });
      updateManyMock.mockResolvedValueOnce({ count: 1 });
      createEventMock.mockResolvedValueOnce({});

      await transitionBooking({ bookingId: "booking-1", toStatus: "CONFIRMED", actorType: "PROVIDER" });

      expect(updateManyMock).toHaveBeenNthCalledWith(1, {
        where: { id: "booking-1", status: "PENDING_PROVIDER" },
        data: { status: "CONFIRMED", confirmedAt: expect.any(Date) },
      });
    });
  });
});

describe("transitionBookingAndFireHooks", () => {
  it("runs the transition inside $transaction, then fires the hook only after it resolves", async () => {
    findUniqueMock.mockResolvedValue({ ...BOOKING_ROW, status: "PENDING_PROVIDER" });
    updateManyMock.mockResolvedValue({ count: 1 });
    createEventMock.mockResolvedValue({});

    const expectedCtx = {
      bookingId: "booking-1",
      customerId: "customer-1",
      providerId: "provider-1",
      serviceId: "service-1",
      fromStatus: "PENDING_PROVIDER",
      toStatus: "CONFIRMED",
    };

    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback({
        booking: { findUnique: findUniqueMock, updateMany: updateManyMock },
        bookingStatusEvent: { create: createEventMock },
      });
    });

    const result = await transitionBookingAndFireHooks({
      bookingId: "booking-1",
      toStatus: "CONFIRMED",
      actorType: "PROVIDER",
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(expectedCtx);
    expect(result).toEqual(expectedCtx);
  });
});
