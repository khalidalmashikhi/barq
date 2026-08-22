import { describe, it, expect, vi, afterEach } from "vitest";

// Production Hardening — regression tests for createBooking(), focused
// on the new rate-limit integration point plus enough of the existing
// happy/invalid-input paths to prove the new check doesn't break
// legitimate bookings. Mirrors accept-booking.test.ts's mocking shape.
//
// No test previously existed for this file; a full audit of every
// existing branch (slot capacity race, duplicate-booking guard, etc.)
// is out of this phase's scope — see PRODUCTION_READINESS.md's own
// "Known Gaps" section, which already documents create-booking.ts as
// untested prior to this phase.

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

const recordBookingCreatedMock = vi.fn();
const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();

vi.mock("@/lib/booking/lifecycle", () => ({
  recordBookingCreated: (...args: unknown[]) => recordBookingCreatedMock(...args),
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

const serviceFindFirstMock = vi.fn();
const priceFindFirstMock = vi.fn();
const bookingCreateMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findFirst: (...args: unknown[]) => serviceFindFirstMock(...args) },
    price: { findFirst: (...args: unknown[]) => priceFindFirstMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: (...args: unknown[]) => executeRawMock(...args),
        booking: { create: (...args: unknown[]) => bookingCreateMock(...args) },
      }),
  },
}));

const { createBooking } = await import("./create-booking");
const { _resetRateLimitStoreForTests } = await import("@/lib/rate-limit/rate-limiter");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PRICE_ID = "019f4e4e-80b8-7cf2-b043-916c71648fcb";
const PROVIDER_ID = "019f4e4e-80dd-7760-9398-7bbb2cd8f5ea";
const CUSTOMER_ID = "019f4e4e-8200-7a11-9c3e-1a2b3c4d5e6f";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  requireCustomerMock.mockReset();
  recordBookingCreatedMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  serviceFindFirstMock.mockReset();
  priceFindFirstMock.mockReset();
  bookingCreateMock.mockReset();
  executeRawMock.mockReset();
  _resetRateLimitStoreForTests();
  vi.unstubAllEnvs();
});

describe("createBooking", () => {
  it("returns INVALID_INPUT for a malformed serviceId, without checking auth", async () => {
    const result = await createBooking(formData({ serviceId: "not-a-uuid", priceId: PRICE_ID }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireCustomerMock).not.toHaveBeenCalled();
  });

  it("creates a booking on the happy path (no slot selected)", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });

    const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

    expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ hook: "context" });
  });

  it("BOOKING-VEHICLE-1 — a customer can NEVER set the vehicle: a client vehicleId field is ignored", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });

    // Hostile input: a client tries to pre-assign a vehicle at booking creation.
    const result = await createBooking(
      formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, vehicleId: "019f4e4e-9000-7052-b15e-b79b5ccb1aaa" })
    );

    expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    // The persisted booking data carries NO vehicleId — assignment is a provider-acceptance
    // concern only; Booking.vehicleId stays null while PENDING_PROVIDER.
    const createArg = bookingCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(createArg.data).not.toHaveProperty("vehicleId");
  });

  describe("provider deactivation enforcement (Production Blocker fix)", () => {
    it("queries the service with the provider APPROVED+visible gate, not just Service.status", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue(null);

      await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(serviceFindFirstMock).toHaveBeenCalledWith({
        where: { id: SERVICE_ID, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
      });
    });

    it("returns SERVICE_UNAVAILABLE for a service whose provider has since been deactivated — the exact scenario this fix closes", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      // A real deactivated-provider service is simply never returned by
      // the (now-guarded) query — simulated here by the mock resolving
      // null, exactly what the guarded `where` clause would produce
      // against a real database.
      serviceFindFirstMock.mockResolvedValue(null);

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(result).toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
      expect(bookingCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting (Production Hardening)", () => {
    it("returns RATE_LIMITED once the per-customer booking-creation limit is exceeded, without touching the database", async () => {
      vi.stubEnv("RATE_LIMIT_BOOKING_CREATE_MAX", "1");
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });

      const first = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));
      expect(first).toEqual({ ok: true, bookingId: "new-booking-id" });

      const second = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));
      expect(second).toEqual({ ok: false, error: "RATE_LIMITED" });
      // The second, rejected attempt must never reach the database.
      expect(serviceFindFirstMock).toHaveBeenCalledTimes(1);
    });

    it("tracks the limit per customer, not globally", async () => {
      vi.stubEnv("RATE_LIMIT_BOOKING_CREATE_MAX", "1");
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });

      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      const first = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));
      expect(first).toEqual({ ok: true, bookingId: "new-booking-id" });

      requireCustomerMock.mockResolvedValue({ customer: { id: "a-different-customer-id" } });
      const second = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));
      expect(second).toEqual({ ok: true, bookingId: "new-booking-id" });
    });
  });
});
