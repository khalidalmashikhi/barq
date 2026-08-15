import { describe, it, expect, vi, afterEach } from "vitest";

// Direct domain-level tests for startBooking() — the Gate PC follow-up closes the
// audit-identified gap (no test previously existed for this file). Mirrors the
// mocking shape of accept-booking.test.ts. These assert CURRENT behavior; they do
// not change it.
//
// Concurrency is NOT implemented at this layer: startBooking delegates the guarded
// status write to transitionBooking() (the lifecycle engine, mocked here), which
// owns the ConcurrentBookingModificationError guard and has its own coverage. This
// file owns: input validation, provider-ownership isolation, the start precondition,
// and the fact that starting a booking NEVER changes capacity (seats were reserved
// at creation; CONFIRMED -> IN_PROGRESS doesn't touch them).

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

const canStartBookingMock = vi.fn();
vi.mock("@/lib/booking/cancellation-policy", () => ({
  canStartBooking: (...a: unknown[]) => canStartBookingMock(...a),
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
    // The tx exposes $executeRaw so we can PROVE start-booking never calls it.
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ $executeRaw: (...a: unknown[]) => executeRawMock(...a) }),
  },
}));

const { startBooking } = await import("./start-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireProviderMock.mockReset();
  canStartBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  bookingFindUniqueMock.mockReset();
  executeRawMock.mockReset();
});

describe("startBooking", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking provider status", async () => {
    const result = await startBooking("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND for a booking owned by ANOTHER provider (ownership isolation)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-2", status: "CONFIRMED" });

    const result = await startBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    expect(canStartBookingMock).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND for a missing booking (indistinguishable from not-owned)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(null);
    expect(await startBooking(BOOKING_ID)).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
  });

  it("returns BOOKING_NOT_STARTABLE when the current status isn't startable, without transitioning", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "PENDING_PROVIDER" });
    canStartBookingMock.mockReturnValue(false);

    const result = await startBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_STARTABLE" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("starts an owned confirmed booking: transitions to IN_PROGRESS, dispatches the hook, NEVER changes capacity", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "CONFIRMED", seats: 2 });
    canStartBookingMock.mockReturnValue(true);
    const hookContext = { bookingId: BOOKING_ID, toStatus: "IN_PROGRESS" };
    transitionBookingMock.mockResolvedValue(hookContext);
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await startBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(transitionBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        toStatus: "IN_PROGRESS",
        actorType: "PROVIDER",
        actorId: "provider-1",
      }),
      expect.anything()
    );
    // No capacity mutation on start.
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });
});
