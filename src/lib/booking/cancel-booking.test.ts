import { describe, it, expect, vi, afterEach } from "vitest";

// BOOKING-CONFLICT-1B — focused coverage for the CUSTOMER cancelBooking() release path
// (this action had no dedicated test before 1B). Mirrors the admin cancel test's mocking
// shape. Asserts that an eligible cancellation releases the vehicle's occupancy hold in the
// same transaction as the status change + seat-capacity release, and never clears the
// assignment history (cancel never updates the booking row itself).

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireCustomerMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCustomer: (...args: unknown[]) => requireCustomerMock(...args),
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

const releaseVehicleMock = vi.fn();
vi.mock("@/lib/booking/vehicle-reservation", () => ({
  releaseVehicleReservationForBooking: (...args: unknown[]) => releaseVehicleMock(...args),
}));

const bookingFindUniqueMock = vi.fn();
const bookingUpdateMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => bookingFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: (...args: unknown[]) => executeRawMock(...args),
        booking: { update: (...args: unknown[]) => bookingUpdateMock(...args) },
      }),
  },
}));

const { cancelBooking } = await import("./cancel-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const CUSTOMER_ID = "019f4e4e-2222-7052-b15e-b79b5ccb1aaa";

afterEach(() => {
  requireCustomerMock.mockReset();
  canCancelBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  releaseVehicleMock.mockReset();
  bookingFindUniqueMock.mockReset();
  bookingUpdateMock.mockReset();
  executeRawMock.mockReset();
});

describe("cancelBooking (customer) — vehicle reservation release", () => {
  it("returns INVALID_INPUT for a malformed bookingId without authenticating", async () => {
    const result = await cancelBooking("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireCustomerMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_FOUND when the booking belongs to another customer", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, customerId: "someone-else", status: "CONFIRMED" });

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("releases the vehicle reservation + capacity in the same transaction on an eligible cancel", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
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

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(releaseVehicleMock).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, expect.any(Date));
    expect(executeRawMock).toHaveBeenCalled(); // seat-capacity release (distinct resource)
    // History invariant: cancellation never updates the booking row, so vehicleId /
    // vehicleSnapshot / operationalStartAt/endAt are all left intact.
    expect(bookingUpdateMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });

  it("still releases the reservation when the booking has no availability slot (idempotent, no capacity release)", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      customerId: CUSTOMER_ID,
      status: "CONFIRMED",
      availabilityId: null,
      seats: 1,
    });
    canCancelBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CANCELLED" });
    releaseVehicleMock.mockResolvedValue({ released: 0 });
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await cancelBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(executeRawMock).not.toHaveBeenCalled(); // no slot → no capacity release
    expect(releaseVehicleMock).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, expect.any(Date));
  });
});
