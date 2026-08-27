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

// AUTH-DUAL-VERIFICATION-1 — createBooking() now enforces the dual-verified
// customer gate. Mocked here so this file keeps testing createBooking's own logic;
// the guard has dedicated tests in require-complete-customer.test.ts.
const isCustomerCompleteForActionMock = vi.fn();
vi.mock("@/lib/auth/require-complete-customer", () => ({
  isCustomerCompleteForAction: (...args: unknown[]) => isCustomerCompleteForActionMock(...args),
}));

const recordBookingCreatedMock = vi.fn();
const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();

vi.mock("@/lib/booking/lifecycle", () => ({
  recordBookingCreated: (...args: unknown[]) => recordBookingCreatedMock(...args),
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

// BOOKING-SLOT-AUTHORITY — createBooking() now consults the slot authority before
// accepting a slot-less booking. Mocked as a module (not through the prisma mock) so
// this file keeps testing createBooking's DECISION, not the authority's own query —
// which has its own dedicated tests in service-requires-slot.test.ts.
const serviceRequiresSlotMock = vi.fn();

vi.mock("@/lib/booking/service-requires-slot", () => ({
  serviceRequiresSlot: (...args: unknown[]) => serviceRequiresSlotMock(...args),
}));

const serviceFindFirstMock = vi.fn();
const priceFindFirstMock = vi.fn();
const bookingCreateMock = vi.fn();
const availabilityFindFirstMock = vi.fn();
const bookingFindFirstMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findFirst: (...args: unknown[]) => serviceFindFirstMock(...args) },
    price: { findFirst: (...args: unknown[]) => priceFindFirstMock(...args) },
    // Needed only by the slotted happy-path test below; the pre-existing tests never
    // reach these because they book slot-lessly.
    availability: { findFirst: (...args: unknown[]) => availabilityFindFirstMock(...args) },
    booking: { findFirst: (...args: unknown[]) => bookingFindFirstMock(...args) },
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
const AVAILABILITY_ID = "019f4e4e-8300-7b22-8d4f-2b3c4d5e6f70";

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
  // Default: a genuinely slotless service, so every pre-existing test keeps exercising
  // the exact path it was written for.
  serviceRequiresSlotMock.mockReset();
  serviceRequiresSlotMock.mockResolvedValue(false);
  priceFindFirstMock.mockReset();
  bookingCreateMock.mockReset();
  // Reset the CALL COUNT too, not just the behaviour: without this the spy accumulates
  // across the whole file and any "called once" assertion silently measures every test.
  isCustomerCompleteForActionMock.mockReset();
  // Default: a COMPLETE customer, so every pre-existing test keeps describing the
  // booking it was written for. The incomplete case is exercised explicitly below.
  isCustomerCompleteForActionMock.mockResolvedValue(true);
  availabilityFindFirstMock.mockReset();
  bookingFindFirstMock.mockReset();
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


  // BOOKING-SLOT-AUTHORITY — the slot-required rule, and the capacity hole it closes.
  describe("slot requirement enforcement (BOOKING-SLOT-AUTHORITY)", () => {
    function slotBasedService() {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });
      serviceRequiresSlotMock.mockResolvedValue(true);
    }

    /**
     * THE REGRESSION THIS WHOLE GATE EXISTS FOR.
     *
     * The atomic `bookedCount + seats <= capacity` guard runs ONLY when an
     * availabilityId is present. So before this check, omitting one against a
     * slot-based service produced a real, confirmed booking that consumed NO capacity
     * — overbooking that no seat count could ever see. Rejecting BEFORE the
     * transaction is what makes that impossible.
     */
    it("omitting availabilityId can no longer bypass the atomic capacity guard", async () => {
      slotBasedService();

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "99" }));

      expect(result).toEqual({ ok: false, error: "SLOT_REQUIRED" });
      // Nothing was reserved...
      expect(executeRawMock).not.toHaveBeenCalled();
      // ...nothing was written...
      expect(bookingCreateMock).not.toHaveBeenCalled();
      // ...and no lifecycle or provider-notification side effect fired.
      expect(recordBookingCreatedMock).not.toHaveBeenCalled();
      expect(transitionBookingMock).not.toHaveBeenCalled();
      expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
    });

    it("returns SLOT_REQUIRED when availabilityId is omitted entirely", async () => {
      slotBasedService();

      expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID })))
        .toEqual({ ok: false, error: "SLOT_REQUIRED" });
    });

    /** An empty string is treated as absent, not as a malformed uuid. */
    it("returns SLOT_REQUIRED for an empty-string availabilityId", async () => {
      slotBasedService();

      expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: "" })))
        .toEqual({ ok: false, error: "SLOT_REQUIRED" });
    });

    it("derives the rule from the authority, never from the request", async () => {
      slotBasedService();

      // Hostile input: the client asserts no slot is needed.
      await createBooking(
        formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, requiresSlot: "false", slotRequired: "no" })
      );

      expect(serviceRequiresSlotMock).toHaveBeenCalledWith(SERVICE_ID);
      expect(bookingCreateMock).not.toHaveBeenCalled();
    });

    /** SLOT_REQUIRED is not SLOT_UNAVAILABLE: nothing was selected to become unavailable. */
    it("is a distinct code from SLOT_UNAVAILABLE and SLOT_FULL", async () => {
      slotBasedService();

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(result).toEqual({ ok: false, error: "SLOT_REQUIRED" });
      expect(result).not.toEqual({ ok: false, error: "SLOT_UNAVAILABLE" });
      expect(result).not.toEqual({ ok: false, error: "SLOT_FULL" });
    });

    /** The genuinely slotless service is untouched by any of this. */
    it("a service with no declared availability still books without a slot", async () => {
      slotBasedService();
      serviceRequiresSlotMock.mockResolvedValue(false);

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
      expect(bookingCreateMock).toHaveBeenCalled();
    });

    /**
     * The check only guards the ABSENT case. A supplied slot goes through the existing
     * ownership/state/time validation and the atomic guard exactly as before — the
     * authority is not consulted a second time to second-guess it.
     */
    it("a slot-based service booked WITH a slot is unaffected", async () => {
      slotBasedService();
      availabilityFindFirstMock.mockResolvedValue({ id: AVAILABILITY_ID, serviceId: SERVICE_ID, state: "OPEN" });
      bookingFindFirstMock.mockResolvedValue(null);
      executeRawMock.mockResolvedValue(1);

      const result = await createBooking(
        formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: AVAILABILITY_ID, seats: "2" })
      );

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
      expect(executeRawMock).toHaveBeenCalled();
      expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ hook: "context" });
    });

    // BOOKING-INTERVAL-1 — a slot-based booking snapshots the selected Availability's
    // start/end onto the Booking operational interval at create (server-derived, not client).
    it("snapshots the selected Availability start/end onto the Booking operational interval", async () => {
      slotBasedService();
      const start = new Date("2026-06-01T09:00:00.000Z");
      const end = new Date("2026-06-01T12:00:00.000Z");
      availabilityFindFirstMock.mockResolvedValue({ id: AVAILABILITY_ID, serviceId: SERVICE_ID, state: "OPEN", startTime: start, endTime: end });
      bookingFindFirstMock.mockResolvedValue(null);
      executeRawMock.mockResolvedValue(1);

      const result = await createBooking(
        formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: AVAILABILITY_ID, seats: "2" })
      );

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
      const data = (bookingCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
      expect(data.operationalStartAt).toEqual(start);
      expect(data.operationalEndAt).toEqual(end);
    });

    // A genuinely slotless booking carries no interval at create (provider schedules at acceptance).
    it("a slotless booking is created with no operational interval", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });
      serviceRequiresSlotMock.mockResolvedValue(false);

      await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      const data = (bookingCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty("operationalStartAt");
      expect(data).not.toHaveProperty("operationalEndAt");
    });

    /** Rejection happens before the price lookup — no wasted work, no partial state. */
    it("rejects before any transaction is opened", async () => {
      slotBasedService();

      await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(priceFindFirstMock).not.toHaveBeenCalled();
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

  // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — the root cause, and its replacement.
  //
  // The dual-verification RULE is correct and unchanged. What was wrong is that
  // createBooking() enforced it by REDIRECTING: a browser navigation instruction, not
  // an answer. POST /api/v1/me/bookings therefore handed a native client a thrown
  // NEXT_REDIRECT it could neither read nor act on. It now returns a domain error, and
  // each transport presents that its own way.
  describe("incomplete customer (dual-verification gate)", () => {
    it("returns CUSTOMER_INCOMPLETE rather than navigating anywhere", async () => {
      // A real, resolved customer — the gate sits after requireCustomer(), so this is
      // someone who HAS a Customer row and is refused purely on credential state.
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      isCustomerCompleteForActionMock.mockResolvedValue(false);

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(result).toEqual({ ok: false, error: "CUSTOMER_INCOMPLETE" });
    });

    /**
     * ZERO SIDE EFFECTS. A customer who may not book must leave no trace: no booking
     * row, no capacity consumed, no payment, no lifecycle event. The check runs before
     * any write, and this is what proves it stays there.
     */
    it("writes nothing at all when it refuses", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      isCustomerCompleteForActionMock.mockResolvedValue(false);

      await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(bookingCreateMock).not.toHaveBeenCalled();
      expect(recordBookingCreatedMock).not.toHaveBeenCalled();
      expect(transitionBookingMock).not.toHaveBeenCalled();
      expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
    });

    it("still creates a booking for a complete customer", async () => {
      isCustomerCompleteForActionMock.mockResolvedValue(true);
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    });

    /** The completeness gate is consulted exactly once per attempt. */
    it("consults the shared authority, not an ad-hoc credential check", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      isCustomerCompleteForActionMock.mockResolvedValue(false);

      await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

      expect(isCustomerCompleteForActionMock).toHaveBeenCalledTimes(1);
    });
  });
});
