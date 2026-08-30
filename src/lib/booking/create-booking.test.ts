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
// BOOKING-IDEMPOTENCY — the durable idempotency table's reads (pre-transaction fast path + the
// post-P2002 replay re-read) and its in-transaction claim insert.
const idempotencyFindUniqueMock = vi.fn();
const idempotencyCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: { findFirst: (...args: unknown[]) => serviceFindFirstMock(...args) },
    price: { findFirst: (...args: unknown[]) => priceFindFirstMock(...args) },
    // Needed only by the slotted happy-path test below; the pre-existing tests never
    // reach these because they book slot-lessly.
    availability: { findFirst: (...args: unknown[]) => availabilityFindFirstMock(...args) },
    booking: { findFirst: (...args: unknown[]) => bookingFindFirstMock(...args) },
    bookingIdempotencyKey: { findUnique: (...args: unknown[]) => idempotencyFindUniqueMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: (...args: unknown[]) => executeRawMock(...args),
        booking: { create: (...args: unknown[]) => bookingCreateMock(...args) },
        bookingIdempotencyKey: { create: (...args: unknown[]) => idempotencyCreateMock(...args) },
      }),
  },
}));

const { createBooking } = await import("./create-booking");
const { computeBookingRequestFingerprint } = await import("./idempotency");
const { Prisma } = await import("@prisma/client");
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
  // Idempotency defaults: no prior claim (findUnique → null) and a successful claim insert. With
  // these defaults, tests that supply NO key never touch either mock (the code skips them), so the
  // whole pre-existing suite is unaffected.
  idempotencyFindUniqueMock.mockReset();
  idempotencyFindUniqueMock.mockResolvedValue(null);
  idempotencyCreateMock.mockReset();
  idempotencyCreateMock.mockResolvedValue({ id: "idem-row" });
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
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });

    const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID }));

    expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith({ hook: "context" });
  });

  it("BOOKING-VEHICLE-1 — a customer can NEVER set the vehicle: a client vehicleId field is ignored", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
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

  // SERVICE INFORMATION MODEL — the per-booking seat bounds authored on the Service
  // are now enforced at booking time (the user's "enforce at booking now" decision).
  // The bounds are OPTIONAL: a NULL bound imposes nothing. The check sits before the
  // transaction, so a rejection writes nothing.
  describe("per-booking seat bounds (SERVICE INFORMATION MODEL)", () => {
    // A slotless, bookable service carrying explicit min/max seat bounds. Slotless so the
    // happy path reaches booking creation without an availability lookup.
    function boundedService(bounds: { minBookingSeats: number | null; maxBookingSeats: number | null }) {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED", ...bounds });
      priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "50", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
      bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
      transitionBookingMock.mockResolvedValue({ hook: "context" });
    }

    it("rejects seats below the minimum with BOOKING_QUANTITY_OUT_OF_RANGE and writes nothing", async () => {
      boundedService({ minBookingSeats: 2, maxBookingSeats: 6 });

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "1" }));

      expect(result).toEqual({ ok: false, error: "BOOKING_QUANTITY_OUT_OF_RANGE" });
      expect(bookingCreateMock).not.toHaveBeenCalled();
      expect(transitionBookingMock).not.toHaveBeenCalled();
      expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
    });

    it("rejects seats above the maximum with BOOKING_QUANTITY_OUT_OF_RANGE", async () => {
      boundedService({ minBookingSeats: 2, maxBookingSeats: 6 });

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "7" }));

      expect(result).toEqual({ ok: false, error: "BOOKING_QUANTITY_OUT_OF_RANGE" });
      expect(bookingCreateMock).not.toHaveBeenCalled();
    });

    it("accepts seats exactly on each inclusive boundary", async () => {
      boundedService({ minBookingSeats: 2, maxBookingSeats: 6 });

      expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "2" })))
        .toEqual({ ok: true, bookingId: "new-booking-id" });

      _resetRateLimitStoreForTests();
      boundedService({ minBookingSeats: 2, maxBookingSeats: 6 });
      expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "6" })))
        .toEqual({ ok: true, bookingId: "new-booking-id" });
    });

    it("a NULL bound imposes nothing (only the min set)", async () => {
      boundedService({ minBookingSeats: 3, maxBookingSeats: null });

      // Well above any figure — but there is no maximum, so nothing rejects it.
      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "999" }));

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    });

    it("a legacy service with no bounds at all still books any positive seat count", async () => {
      boundedService({ minBookingSeats: null, maxBookingSeats: null });

      const result = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "42" }));

      expect(result).toEqual({ ok: true, bookingId: "new-booking-id" });
    });
  });
});

// BOOKING TOTAL CALCULATION — the authoritative pricing snapshot written atomically at create.
describe("createBooking — authoritative pricing snapshot", () => {
  // A slotless, bookable service with a given ACTIVE price. Slotless so the create path
  // reaches booking.create without an availability lookup.
  function priced(price: { amount: string; currency?: string; pricingUnit: string | null }) {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: price.amount, currency: price.currency ?? "OMR", pricingUnit: price.pricingUnit, status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });
  }

  function createdData() {
    return (bookingCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
  }
  function total(data: Record<string, unknown>) {
    // bookingTotalSnapshot is a Prisma.Decimal — normalize to a 2dp string for assertion.
    return (data.bookingTotalSnapshot as { toFixed: (n: number) => string }).toFixed(2);
  }

  it("PER_PERSON: unit 10 × seats 1 → unit 10, quantity 1, total 10", async () => {
    priced({ amount: "10", pricingUnit: "PER_PERSON" });
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "1" }));
    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" });
    const d = createdData();
    expect(String(d.priceSnapshotAmount)).toBe("10"); // UNIT price, unchanged
    expect(d.pricingUnitSnapshot).toBe("PER_PERSON");
    expect(d.billableQuantitySnapshot).toBe(1);
    expect(total(d)).toBe("10.00");
  });

  it("PER_PERSON: unit 10 × seats 5 → quantity 5, total 50 (priceSnapshotAmount stays the UNIT 10)", async () => {
    priced({ amount: "10", pricingUnit: "PER_PERSON" });
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "5" }));
    const d = createdData();
    expect(String(d.priceSnapshotAmount)).toBe("10"); // NEVER the total
    expect(d.billableQuantitySnapshot).toBe(5);
    expect(total(d)).toBe("50.00");
  });

  it("PER_PERSON: Decimal 10.25 × 3 → total 30.75 (no float artifact)", async () => {
    priced({ amount: "10.25", pricingUnit: "PER_PERSON" });
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "3" }));
    expect(total(createdData())).toBe("30.75");
  });

  it("PER_BOOKING: unit 10, seats 5 → billable quantity 1, total 10 (fixed; seats never multiplies)", async () => {
    priced({ amount: "10", pricingUnit: "PER_BOOKING" });
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "5" }));
    const d = createdData();
    expect(d.billableQuantitySnapshot).toBe(1);
    expect(total(d)).toBe("10.00");
    expect(d.seats).toBe(5); // capacity/passenger quantity is unchanged
  });

  it("PER_TRIP: unit 25, seats 4 → billable 1, total 25", async () => {
    priced({ amount: "25", pricingUnit: "PER_TRIP" });
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "4" }));
    const d = createdData();
    expect(d.billableQuantitySnapshot).toBe(1);
    expect(total(d)).toBe("25.00");
  });

  it("PER_VEHICLE: unit 95, seats 4 passengers → billable 1, total 95; seats stays 4 (capacity separate)", async () => {
    priced({ amount: "95", pricingUnit: "PER_VEHICLE" });
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "4" }));
    const d = createdData();
    expect(d.billableQuantitySnapshot).toBe(1);
    expect(total(d)).toBe("95.00");
    expect(d.seats).toBe(4);
  });
});

describe("createBooking — unpriceable units fail closed (no booking, no total guessed)", () => {
  function priced(pricingUnit: string | null) {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "10", currency: "OMR", pricingUnit, status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });
  }

  it.each(["PER_DAY", "PER_HOUR"])("rejects %s with PRICING_UNIT_NOT_BOOKABLE and creates nothing", async (unit) => {
    priced(unit);
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "2" }));
    expect(r).toEqual({ ok: false, error: "PRICING_UNIT_NOT_BOOKABLE" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown pricing unit with PRICING_UNIT_NOT_BOOKABLE", async () => {
    priced("PER_LIGHT_YEAR");
    expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID })))
      .toEqual({ ok: false, error: "PRICING_UNIT_NOT_BOOKABLE" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a NULL pricing unit (never defaulted to PER_BOOKING)", async () => {
    priced(null);
    expect(await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID })))
      .toEqual({ ok: false, error: "PRICING_UNIT_NOT_BOOKABLE" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });

  // Failure atomicity — a pricing failure mutates NOTHING (checked before the capacity guard).
  it("writes nothing at all on a pricing failure: no capacity mutation, no lifecycle, no notification", async () => {
    priced("PER_DAY");
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: AVAILABILITY_ID, seats: "2" }));
    expect(executeRawMock).not.toHaveBeenCalled();     // no bookedCount increment
    expect(bookingCreateMock).not.toHaveBeenCalled();
    expect(recordBookingCreatedMock).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });
});

// PRICING UNIT DATA INTEGRITY — strict booking-quantity parsing (shared web + API seam).
describe("createBooking — strict seats parsing (fail closed on invalid explicit input)", () => {
  function bookable() {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "10", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });
  }

  it("absent seats defaults to 1 (slotless services never submit it)", async () => {
    bookable();
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID })); // no seats key
    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect((bookingCreateMock.mock.calls[0]![0] as { data: { seats: number } }).data.seats).toBe(1);
  });

  it("accepts a valid explicit quantity", async () => {
    bookable();
    await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "5" }));
    expect((bookingCreateMock.mock.calls[0]![0] as { data: { seats: number } }).data.seats).toBe(5);
  });

  it.each(["0", "-1", "1.5", "abc", ""])("FAILS CLOSED for explicit invalid seats %j (no booking, never coerced to 1)", async (bad) => {
    bookable();
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: bad }));
    expect(r).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });
});

// BOOKING-IDEMPOTENCY — the request-idempotency matrix (§24). The DB unique constraint's actual
// race arbitration is a Postgres guarantee proven by the migration/schema (see §25 in the report);
// these tests exercise every application-level branch that constraint drives.
describe("createBooking — idempotency", () => {
  const KEY = "018f2a3b-1c2d-7e3f-9a0b-1c2d3e4f5a6b";
  const OTHER_CUSTOMER_ID = "019f4e4e-9999-7a11-9c3e-1a2b3c4d5e6f";

  // A slotless, bookable, complete-customer service.
  function bookable() {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    serviceFindFirstMock.mockResolvedValue({ id: SERVICE_ID, providerId: PROVIDER_ID, status: "PUBLISHED" });
    priceFindFirstMock.mockResolvedValue({ id: PRICE_ID, serviceId: SERVICE_ID, amount: "10", currency: "OMR", pricingUnit: "PER_PERSON", status: "ACTIVE" });
    bookingCreateMock.mockResolvedValue({ id: "new-booking-id" });
    transitionBookingMock.mockResolvedValue({ hook: "context" });
  }

  function withKey(fields: Record<string, string>) {
    return formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, idempotencyKey: KEY, ...fields });
  }

  // §24.1 — a normal keyed booking creates exactly one booking and claims the key with the
  // server-computed fingerprint (over selectors only), bound to the created booking.
  it("creates one booking and claims the key (fingerprint over selectors, bound to the booking)", async () => {
    bookable();
    const r = await createBooking(withKey({ seats: "2" }));
    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect(bookingCreateMock).toHaveBeenCalledTimes(1);
    expect(idempotencyCreateMock).toHaveBeenCalledTimes(1);
    const claim = (idempotencyCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(claim).toEqual({
      customerId: CUSTOMER_ID,
      idempotencyKey: KEY,
      requestFingerprint: computeBookingRequestFingerprint({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: null, seats: 2 }),
      bookingId: "new-booking-id",
    });
  });

  // §24.2 / §24.10 / §24.11 / §24.18 / §24.21 — a same-key same-request retry REPLAYS the original
  // booking: no new booking, no lifecycle/notification, no re-pricing, no capacity mutation.
  it("same key + same request → replays the ORIGINAL booking with zero repeated side effects", async () => {
    bookable();
    idempotencyFindUniqueMock.mockResolvedValue({
      bookingId: "original-booking-id",
      requestFingerprint: computeBookingRequestFingerprint({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: null, seats: 2 }),
    });

    const r = await createBooking(withKey({ seats: "2" }));

    expect(r).toEqual({ ok: true, bookingId: "original-booking-id" }); // the ORIGINAL, not a new id
    expect(bookingCreateMock).not.toHaveBeenCalled();
    expect(idempotencyCreateMock).not.toHaveBeenCalled();
    expect(recordBookingCreatedMock).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();       // no capacity consumed on replay
    expect(priceFindFirstMock).not.toHaveBeenCalled();   // §21 — never re-priced against today's Price
  });

  // §24.3–§24.6 — same key reused for a materially DIFFERENT request → conflict (fail closed),
  // never returns the wrong booking, creates nothing.
  it.each([
    ["different service", { serviceId: "019f4e4e-8116-7052-b15e-b79b5ccb1aaa" }],
    ["different price", { priceId: "019f4e4e-80b8-7cf2-b043-916c71648aaa" }],
    ["different availability", { availabilityId: AVAILABILITY_ID }],
    ["different quantity", { seats: "3" }],
  ])("same key + %s → IDEMPOTENCY_KEY_CONFLICT, nothing created", async (_label, override) => {
    bookable();
    // The stored claim is the ORIGINAL base request (seats 2, no slot); the retry differs by one selector.
    idempotencyFindUniqueMock.mockResolvedValue({
      bookingId: "original-booking-id",
      requestFingerprint: computeBookingRequestFingerprint({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: null, seats: 2 }),
    });
    // Slot override needs a valid, OPEN slot so the request reaches the fingerprint comparison identically.
    availabilityFindFirstMock.mockResolvedValue({ id: AVAILABILITY_ID, serviceId: SERVICE_ID, state: "OPEN" });
    bookingFindFirstMock.mockResolvedValue(null);

    const r = await createBooking(withKey({ seats: "2", ...override }));

    expect(r).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
    expect(idempotencyCreateMock).not.toHaveBeenCalled();
  });

  // §24.7 / §17 — a key is scoped to the authenticated customer. Customer B using a key that
  // customer A created can NEVER see A's booking; the scoped lookup misses and B books their own.
  it("same key used by a DIFFERENT customer cannot surface the first customer's booking", async () => {
    bookable();
    requireCustomerMock.mockResolvedValue({ customer: { id: OTHER_CUSTOMER_ID } });
    // The lookup is scoped by customerId — model that: A's row exists, but not under B's id.
    idempotencyFindUniqueMock.mockImplementation((args: { where: { customerId_idempotencyKey: { customerId: string } } }) => {
      return Promise.resolve(args.where.customerId_idempotencyKey.customerId === CUSTOMER_ID
        ? { bookingId: "customer-A-booking", requestFingerprint: "irrelevant" }
        : null);
    });

    const r = await createBooking(withKey({ seats: "2" }));

    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" }); // B's OWN booking, never A's
    expect(idempotencyFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId_idempotencyKey: { customerId: OTHER_CUSTOMER_ID, idempotencyKey: KEY } } })
    );
  });

  // §24.8 / §11 — the truly CONCURRENT race: our in-transaction claim loses to a simultaneous
  // request (P2002), the transaction rolls back, and we REPLAY the committed winner — one booking.
  it("concurrent same-key race (P2002 on the claim) → replays the winner, not a second booking", async () => {
    bookable();
    // No prior claim at the pre-tx check (both requests raced past it)...
    idempotencyFindUniqueMock.mockResolvedValueOnce(null);
    // ...our in-tx claim hits the unique violation...
    idempotencyCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" }));
    // ...and the post-P2002 re-read finds the committed winner with a matching fingerprint.
    idempotencyFindUniqueMock.mockResolvedValueOnce({
      bookingId: "winner-booking-id",
      requestFingerprint: computeBookingRequestFingerprint({ serviceId: SERVICE_ID, priceId: PRICE_ID, availabilityId: null, seats: 2 }),
    });

    const r = await createBooking(withKey({ seats: "2" }));

    expect(r).toEqual({ ok: true, bookingId: "winner-booking-id" });
  });

  // §24.8 companion — a concurrent P2002 whose winner is a DIFFERENT request is a conflict.
  it("concurrent P2002 with a different winning request → conflict", async () => {
    bookable();
    idempotencyFindUniqueMock.mockResolvedValueOnce(null);
    idempotencyCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" }));
    idempotencyFindUniqueMock.mockResolvedValueOnce({ bookingId: "winner", requestFingerprint: "a-different-request-fingerprint" });

    const r = await createBooking(withKey({ seats: "2" }));

    expect(r).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  // §24.14 / §24.15 / §4 — a malformed key fails closed BEFORE authentication (cheap, no work).
  it.each([
    ["too short", "short"],
    ["unsafe chars", "has space key"],
    ["oversized", "x".repeat(201)],
  ])("rejects a %s idempotency key with IDEMPOTENCY_KEY_INVALID, before auth", async (_label, badKey) => {
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, idempotencyKey: badKey }));
    expect(r).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_INVALID" });
    expect(requireCustomerMock).not.toHaveBeenCalled();
    expect(bookingCreateMock).not.toHaveBeenCalled();
  });

  // §24.16 — a failed validation (bad seats) with a key present creates neither a booking nor a claim.
  it("a validation failure with a key present claims nothing", async () => {
    bookable();
    const r = await createBooking(withKey({ seats: "0" }));
    expect(r).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(bookingCreateMock).not.toHaveBeenCalled();
    expect(idempotencyCreateMock).not.toHaveBeenCalled();
  });

  // §24.17 / §15 — a capacity failure (SLOT_FULL) with a key present claims NOTHING, so the key
  // stays reusable after a genuinely failed attempt (the claim is inserted last, inside the tx).
  it("a capacity failure claims no key (the failed attempt does not poison it)", async () => {
    bookable();
    serviceRequiresSlotMock.mockResolvedValue(true);
    availabilityFindFirstMock.mockResolvedValue({ id: AVAILABILITY_ID, serviceId: SERVICE_ID, state: "OPEN", startTime: new Date("2026-06-01T09:00:00Z"), endTime: new Date("2026-06-01T12:00:00Z") });
    bookingFindFirstMock.mockResolvedValue(null);
    executeRawMock.mockResolvedValue(0); // capacity lost → the tx throws SLOT_FULL

    const r = await createBooking(withKey({ availabilityId: AVAILABILITY_ID, seats: "2" }));

    expect(r).toEqual({ ok: false, error: "SLOT_FULL" });
    expect(idempotencyCreateMock).not.toHaveBeenCalled();
  });

  // §24.12 / §24.13 — slotless replay is one booking; a DIFFERENT key is a new legitimate attempt.
  it("a slotless booking with a NEW (unseen) key is a fresh attempt that books", async () => {
    bookable();
    serviceRequiresSlotMock.mockResolvedValue(false);
    idempotencyFindUniqueMock.mockResolvedValue(null); // unseen key

    const r = await createBooking(withKey({}));

    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect(idempotencyCreateMock).toHaveBeenCalledTimes(1);
  });

  // Backward compatibility — NO key supplied behaves exactly as before (no idempotency work).
  it("no key supplied → books as before, touching neither idempotency read nor claim", async () => {
    bookable();
    const r = await createBooking(formData({ serviceId: SERVICE_ID, priceId: PRICE_ID, seats: "2" }));
    expect(r).toEqual({ ok: true, bookingId: "new-booking-id" });
    expect(idempotencyFindUniqueMock).not.toHaveBeenCalled();
    expect(idempotencyCreateMock).not.toHaveBeenCalled();
  });
});
