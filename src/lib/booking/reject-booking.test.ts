import { describe, it, expect, vi, afterEach } from "vitest";

// Direct domain-level tests for rejectBooking() — the Gate PC follow-up closes the
// audit-identified gap (no test previously existed for this file). Mirrors the
// mocking shape of accept-booking.test.ts. These assert CURRENT behavior; they do
// not change it.
//
// Concurrency is NOT implemented at this layer: rejectBooking delegates the guarded
// status write to transitionBooking() (the lifecycle engine, mocked here), which
// owns the ConcurrentBookingModificationError guard and has its own coverage. What
// this file owns is: input validation, provider-ownership isolation, the reject
// precondition, and the authoritative capacity release.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const canRejectBookingMock = vi.fn();
vi.mock("@/lib/booking/cancellation-policy", () => ({
  canRejectBooking: (...a: unknown[]) => canRejectBookingMock(...a),
}));

const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();
vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...a: unknown[]) => transitionBookingMock(...a),
  dispatchLifecycleHook: (...a: unknown[]) => dispatchLifecycleHookMock(...a),
}));

const bookingFindUniqueMock = vi.fn();
const executeRawMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findUnique: (...a: unknown[]) => bookingFindUniqueMock(...a) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ $executeRaw: (...a: unknown[]) => executeRawMock(...a) }),
  },
}));

const { rejectBooking } = await import("./reject-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireProviderMock.mockReset();
  canRejectBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  bookingFindUniqueMock.mockReset();
  executeRawMock.mockReset();
});

describe("rejectBooking", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking provider status", async () => {
    const result = await rejectBooking("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND for a booking owned by ANOTHER provider (ownership isolation)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-2", status: "PENDING_PROVIDER" });

    const result = await rejectBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    // Never evaluates the precondition or transitions someone else's booking.
    expect(canRejectBookingMock).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND for a missing booking (indistinguishable from not-owned)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(null);
    expect(await rejectBooking(BOOKING_ID)).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
  });

  it("returns BOOKING_NOT_PENDING when the current status isn't rejectable, without transitioning", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "CONFIRMED" });
    canRejectBookingMock.mockReturnValue(false);

    const result = await rejectBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_PENDING" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("rejects an owned pending booking: transitions to REJECTED, releases capacity authoritatively, dispatches the hook", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      seats: 3,
      availabilityId: "avail-1",
    });
    canRejectBookingMock.mockReturnValue(true);
    const hookContext = { bookingId: BOOKING_ID, toStatus: "REJECTED" };
    transitionBookingMock.mockResolvedValue(hookContext);
    executeRawMock.mockResolvedValue(1);
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await rejectBooking(BOOKING_ID, "fully booked");

    expect(result).toEqual({ ok: true });
    expect(transitionBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        toStatus: "REJECTED",
        actorType: "PROVIDER",
        actorId: "provider-1",
        reason: "fully booked",
      }),
      expect.anything()
    );
    // Capacity release uses the booking's OWN seat count and availability id — the
    // authoritative "free the reserved seats" write, same as a cancellation.
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const rawArgs = executeRawMock.mock.calls[0]!;
    expect(rawArgs).toContain(3); // booking.seats
    expect(rawArgs).toContain("avail-1"); // booking.availabilityId
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });

  it("does NOT touch capacity when the booking has no availability slot", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      seats: 2,
      availabilityId: null,
    });
    canRejectBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "REJECTED" });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await rejectBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("normalizes the optional reason: blank/whitespace becomes undefined", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      seats: 1,
      availabilityId: null,
    });
    canRejectBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "REJECTED" });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    await rejectBooking(BOOKING_ID, "   ");

    expect(transitionBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: undefined }),
      expect.anything()
    );
  });
});
