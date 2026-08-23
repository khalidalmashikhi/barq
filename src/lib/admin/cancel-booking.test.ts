import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.9 (Booking Foundation) — regression tests for the
// administrative cancelBooking(), mirroring deactivate-price.test.ts's
// mocking shape, adapted for the shared lifecycle engine (transitionBooking
// + dispatchLifecycleHook) rather than a direct field update.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const canCancelBookingMock = vi.fn();

vi.mock("@/lib/booking/cancellation-policy", () => ({
  canCancelBooking: (...args: unknown[]) => canCancelBookingMock(...args),
}));

const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();

vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

// BOOKING-CONFLICT-1B — the vehicle-reservation release primitive is its own unit (see
// vehicle-reservation/release-vehicle-reservation.test.ts). Mocked here so we only assert
// this action invokes it inside the cancellation transaction.
const releaseVehicleMock = vi.fn();
vi.mock("@/lib/booking/vehicle-reservation", () => ({
  releaseVehicleReservationForBooking: (...args: unknown[]) => releaseVehicleMock(...args),
}));

const bookingFindUniqueMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => bookingFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ $executeRaw: (...args: unknown[]) => executeRawMock(...args) }),
  },
}));

const { cancelBooking } = await import("./cancel-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  canCancelBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  bookingFindUniqueMock.mockReset();
  executeRawMock.mockReset();
  releaseVehicleMock.mockReset();
});

describe("cancelBooking (admin)", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking admin status", async () => {
    const result = await cancelBooking("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND when the booking doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    bookingFindUniqueMock.mockResolvedValue(null);

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_CANCELLABLE when the current status isn't eligible", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, status: "COMPLETED", availabilityId: null, seats: 1 });
    canCancelBookingMock.mockReturnValue(false);

    const result = await cancelBooking(BOOKING_ID);

    expect(canCancelBookingMock).toHaveBeenCalledWith("COMPLETED");
    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_CANCELLABLE" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("cancels an eligible booking with actorType ADMIN, releases capacity, and fires the lifecycle hook", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      status: "CONFIRMED",
      availabilityId: "availability-1",
      seats: 2,
    });
    canCancelBookingMock.mockReturnValue(true);
    const hookContext = { bookingId: BOOKING_ID, toStatus: "CANCELLED" };
    transitionBookingMock.mockResolvedValue(hookContext);
    executeRawMock.mockResolvedValue(undefined);
    releaseVehicleMock.mockResolvedValue({ released: 1 });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await cancelBooking(BOOKING_ID, "duplicate request");

    expect(result).toEqual({ ok: true });
    expect(transitionBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        toStatus: "CANCELLED",
        actorType: "ADMIN",
        actorId: "admin-1",
        reason: "duplicate request",
      }),
      expect.anything()
    );
    expect(executeRawMock).toHaveBeenCalled();
    // BOOKING-CONFLICT-1B — the vehicle reservation is released in the same transaction,
    // keyed on the booking id, with a release instant. Distinct from the capacity release above.
    expect(releaseVehicleMock).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, expect.any(Date));
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });

  it("does not touch capacity when the booking has no availabilityId", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      status: "PENDING_PROVIDER",
      availabilityId: null,
      seats: 1,
    });
    canCancelBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CANCELLED" });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("returns UNKNOWN_ERROR and logs when an unexpected exception is thrown", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    bookingFindUniqueMock.mockRejectedValue(new Error("db exploded"));

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});
