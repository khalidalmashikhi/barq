import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConcurrentBookingModificationError } from "@/lib/booking/lifecycle/errors";

// Phase 2.11 (Checkout Foundation) — regression tests for
// acceptBooking(), covering the newly-wired commission snapshot
// calculation (see calculate-commission.ts's own module comment for
// why this is the one correct integration point). No test previously
// existed for this file; mirrors the mocking shape already established
// for src/lib/admin/cancel-booking.test.ts.
//
// Phase 2.12 (Payment Foundation) extended these same tests to cover
// the Payment row now also created at this exact confirmation moment
// (see accept-booking.ts's own module comment).
//
// Phase 2.15A (Wire Payment Gateway Abstraction) added one more test
// confirming the real getPaymentGatewayProvider().initiate() is
// genuinely invoked with the right arguments and that its result flows
// through into the Payment row — everything else here is deliberately
// left unmocked and unmodified: since the real no-op provider is
// side-effect-free and deterministic (no I/O, mirrors
// calculate-commission.ts's own unmocked-pure-function precedent), the
// pre-existing assertions (including status: "INITIATED") still passing
// unchanged is itself the proof that this refactor produced an
// identical Payment row.
//
// Phase 2.23 (Payment Gateway Runtime Wiring) removed the explicit
// "NONE" argument from accept-booking.ts's own call — with
// PAYMENT_PROVIDER unset in this test environment, getPaymentGatewayProvider()
// still resolves to this same real noOpPaymentGatewayProvider, so these
// tests needed no changes; a new test below proves the opposite case
// (PAYMENT_PROVIDER=STRIPE genuinely reaches the real Stripe gateway),
// mocking only the "stripe" SDK itself, the same technique
// stripe-payment-gateway-provider.test.ts already uses.
//
// Phase 2.24 (Provider Reference Persistence) added providerReference
// to every paymentCreateMock assertion below: null for the No-Op
// gateway (which never returns one), and the real Stripe PaymentIntent
// id ("pi_123") for the STRIPE-configured test — proving the value
// initiate() returns is now actually persisted onto the Payment row.
//
// Phase 2.26 (Gateway Idempotency) — the Stripe test's stripeCreateMock
// assertion now includes the deterministic idempotencyKey request
// option stripe-payment-gateway-provider.ts derives from bookingId; see
// that file's own test suite for the dedicated key-derivation coverage.

vi.mock("server-only", () => ({}));

const stripeCreateMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = { create: (...args: unknown[]) => stripeCreateMock(...args) };
  }
  return { default: MockStripe };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const canAcceptBookingMock = vi.fn();

vi.mock("@/lib/booking/cancellation-policy", () => ({
  canAcceptBooking: (...args: unknown[]) => canAcceptBookingMock(...args),
}));

const transitionBookingMock = vi.fn();
const dispatchLifecycleHookMock = vi.fn();

vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...args: unknown[]) => transitionBookingMock(...args),
  dispatchLifecycleHook: (...args: unknown[]) => dispatchLifecycleHookMock(...args),
}));

// BOOKING-VEHICLE-1 — the vehicle-assignment resolver is its own unit (see
// vehicle-assignment-on-accept.test.ts for its matrix). Here it is mocked; the default
// (set in beforeEach) is the no-vehicle path, so every pre-existing test is unchanged.
const resolveVehicleAssignmentMock = vi.fn();
vi.mock("@/lib/booking/vehicle-assignment-on-accept", () => ({
  resolveVehicleAssignmentForAcceptance: (...args: unknown[]) => resolveVehicleAssignmentMock(...args),
}));

// BOOKING-CONFLICT-1B — the vehicle reservation primitive is its own unit (see
// vehicle-reservation/reserve-vehicle.test.ts for its matrix). Here it is mocked; the default
// (set in beforeEach) succeeds, so every vehicle-assignment test that predates 1B is unchanged.
const reserveVehicleMock = vi.fn();
vi.mock("@/lib/booking/vehicle-reservation", () => ({
  reserveVehicleForBooking: (...args: unknown[]) => reserveVehicleMock(...args),
}));

const bookingFindUniqueMock = vi.fn();
const commissionFindFirstMock = vi.fn();
const bookingUpdateMock = vi.fn();
const paymentCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => bookingFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        commission: { findFirst: (...args: unknown[]) => commissionFindFirstMock(...args) },
        booking: { update: (...args: unknown[]) => bookingUpdateMock(...args) },
        payment: { create: (...args: unknown[]) => paymentCreateMock(...args) },
      }),
  },
}));

const { acceptBooking } = await import("./accept-booking");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const VEHICLE_ID = "019f4e4e-9000-7052-b15e-b79b5ccb1aaa";
// BOOKING-VEHICLE-SNAPSHOT — the customer-safe snapshot the resolver returns alongside a vehicle.
const SNAP = { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false };

beforeEach(() => {
  // Default: no vehicle involved (non-tour / GUIDE_ONLY) — the pre-existing behavior.
  resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: null, snapshot: null });
  // Default: the reservation succeeds when a vehicle IS assigned — keeps pre-1B vehicle tests green.
  reserveVehicleMock.mockResolvedValue({ ok: true, reservationId: "res-1" });
});

afterEach(() => {
  requireProviderMock.mockReset();
  canAcceptBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  bookingFindUniqueMock.mockReset();
  commissionFindFirstMock.mockReset();
  bookingUpdateMock.mockReset();
  paymentCreateMock.mockReset();
  resolveVehicleAssignmentMock.mockReset();
  reserveVehicleMock.mockReset();
  stripeCreateMock.mockReset();
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("acceptBooking", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking provider status", async () => {
    const result = await acceptBooking("not-a-uuid");

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireProviderMock).not.toHaveBeenCalled();
  });

  it("returns BOOKING_NOT_PENDING when the current status isn't eligible", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({ id: BOOKING_ID, providerId: "provider-1", status: "CONFIRMED", priceSnapshotAmount: "15" });
    canAcceptBookingMock.mockReturnValue(false);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_PENDING" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("computes and stores the commission snapshot from the provider's ACTIVE Commission when accepting", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    const hookContext = { bookingId: BOOKING_ID, toStatus: "CONFIRMED" };
    transitionBookingMock.mockResolvedValue(hookContext);
    commissionFindFirstMock.mockResolvedValue({ providerId: "provider-1", tier: "TIER_10", status: "ACTIVE" });
    bookingUpdateMock.mockResolvedValue({});
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(commissionFindFirstMock).toHaveBeenCalledWith({ where: { providerId: "provider-1", status: "ACTIVE" } });
    // Commission = effective total (15, LEGACY) × 10% = 1.50, Decimal-safe.
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { commissionSnapshotTier: "TIER_10", commissionSnapshotAmount: "1.50" },
    });
    // Payment.amount is now the resolved effective total (a Prisma.Decimal); assert its value.
    const paymentData = (paymentCreateMock.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect((paymentData.amount as { toString(): string }).toString()).toBe("15");
    expect(paymentData.currency).toBe("OMR");
    expect(paymentData.status).toBe("INITIATED");
    expect(paymentData.providerReference).toBeNull();
    expect(dispatchLifecycleHookMock).toHaveBeenCalledWith(hookContext);
  });

  it("calls the real payment gateway provider's initiate() with bookingId/amount/currency, and its result becomes the Payment's status", async () => {
    const { noOpPaymentGatewayProvider } = await import("@/lib/payments/gateway/providers/no-op-payment-gateway-provider");
    const initiateSpy = vi.spyOn(noOpPaymentGatewayProvider, "initiate");

    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(initiateSpy).toHaveBeenCalledWith({ bookingId: BOOKING_ID, amount: "15", currency: "OMR" });
    expect(paymentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "INITIATED", providerReference: null }),
    });

    initiateSpy.mockRestore();
  });

  it("resolves to the real Stripe gateway and calls its initiate() when PAYMENT_PROVIDER=STRIPE is configured (Phase 2.23 runtime wiring)", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    stripeCreateMock.mockResolvedValue({ id: "pi_123" });

    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(stripeCreateMock).toHaveBeenCalledWith(
      {
        amount: 1500,
        currency: "omr",
        metadata: { bookingId: BOOKING_ID },
        capture_method: "manual",
      },
      { idempotencyKey: `barq:payment:initiate:${BOOKING_ID}` }
    );
    expect(paymentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "INITIATED", providerReference: "pi_123" }),
    });
  });

  it("does not fail acceptance when the provider has no ACTIVE Commission — logs and leaves the snapshot untouched, but still creates the Payment", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(bookingUpdateMock).not.toHaveBeenCalled();
    expect(paymentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ bookingId: BOOKING_ID, currency: "OMR", status: "INITIATED" }),
    });
  });

  it("FAILS CLOSED with BOOKING_PRICING_INVALID when the booking has no resolvable money (no transition, no Payment)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: null,
      priceSnapshotCurrency: null,
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    // DOWNSTREAM MONEY ALIGNMENT — an ABSENT money snapshot can no longer be accepted; it fails
    // closed BEFORE any transition, gateway initiation, commission, or Payment.
    expect(result).toEqual({ ok: false, error: "BOOKING_PRICING_INVALID" });
    expect(paymentCreateMock).not.toHaveBeenCalled();
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  // --- BOOKING-VEHICLE-1 ------------------------------------------------------

  it("writes the provider's chosen vehicle in the SAME transaction as CONFIRMED", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      serviceId: "service-1",
      seats: 4,
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
      // BOOKING-INTERVAL-1 — slot-based booking (interval already snapshotted at create), so
      // acceptance needs no provider schedule and does not re-write the interval.
      operationalStartAt: new Date("2026-06-01T09:00:00.000Z"),
      operationalEndAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    canAcceptBookingMock.mockReturnValue(true);
    // Both the pre-check and the in-transaction re-check resolve to the chosen vehicle + its snapshot.
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null); // isolate the vehicle write from the commission write
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: true });
    // The chosen vehicle + the booking's own serviceId/seats reached the resolver (server-derived).
    expect(resolveVehicleAssignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "service-1", providerId: "provider-1", seats: 4, vehicleId: VEHICLE_ID })
    );
    // BOOKING-VEHICLE-SNAPSHOT — vehicleId AND the snapshot are written together in one update.
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { vehicleId: VEHICLE_ID, vehicleSnapshot: SNAP },
    });
    expect(dispatchLifecycleHookMock).toHaveBeenCalled();
  });

  it("returns the assignment error and never initiates payment or transitions when the vehicle is invalid", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      serviceId: "service-1",
      seats: 4,
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: false, error: "VEHICLE_REQUIRED" });

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "VEHICLE_REQUIRED" });
    // Rejected BEFORE any transaction / payment — no half-applied state.
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(paymentCreateMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  it("aborts acceptance when the vehicle becomes ineligible between the pre-check and the transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      serviceId: "service-1",
      seats: 4,
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
      operationalStartAt: new Date("2026-06-01T09:00:00.000Z"),
      operationalEndAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    canAcceptBookingMock.mockReturnValue(true);
    // Pre-check passes, in-transaction re-check fails (a doc expired / vehicle deactivated).
    resolveVehicleAssignmentMock
      .mockResolvedValueOnce({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP })
      .mockResolvedValueOnce({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
    // The transaction threw → the lifecycle hook (post-commit) never fired.
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
    // BOOKING-VEHICLE-SNAPSHOT — no partial write: vehicleId/vehicleSnapshot were never persisted
    // (commission is null here, so booking.update is not called at all).
    expect(bookingUpdateMock).not.toHaveBeenCalled();
  });

  it("maps a concurrent modification inside the guarded transition to BOOKING_STATE_CONFLICT", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      serviceId: "service-1",
      seats: 1,
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" },
      priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockRejectedValue(new ConcurrentBookingModificationError(BOOKING_ID));

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_STATE_CONFLICT" });
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  // --- BOOKING-INTERVAL-1 ------------------------------------------------------

  const SLOTLESS_BOOKING = {
    id: BOOKING_ID, providerId: "provider-1", serviceId: "service-1", seats: 4, status: "PENDING_PROVIDER",
    priceSnapshotAmount: { toString: () => "15" }, priceSnapshotCurrency: "OMR",
    operationalStartAt: null, operationalEndAt: null, // slotless: no interval yet
  };
  const START = new Date("2026-07-01T06:00:00.000Z");
  const END = new Date("2026-07-01T10:00:00.000Z");

  it("slotless vehicle-required acceptance with NO schedule → SCHEDULE_REQUIRED, before payment/transition", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(SLOTLESS_BOOKING);
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID); // no schedule supplied

    expect(result).toEqual({ ok: false, error: "SCHEDULE_REQUIRED" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(paymentCreateMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  it("slotless vehicle-required acceptance with a reversed interval → INVALID_SCHEDULE", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(SLOTLESS_BOOKING);
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID, END, START); // end before start

    expect(result).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
  });

  it("slotless vehicle-required acceptance with a valid schedule → CONFIRMED, writing vehicle + snapshot + interval together", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(SLOTLESS_BOOKING);
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID, START, END);

    expect(result).toEqual({ ok: true });
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { vehicleId: VEHICLE_ID, vehicleSnapshot: SNAP, operationalStartAt: START, operationalEndAt: END },
    });
  });

  it("slot-based booking: provider-supplied schedule is IGNORED (cannot override the slot-derived interval)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      ...SLOTLESS_BOOKING,
      // Already has a slot-derived interval → provider cannot override it.
      operationalStartAt: new Date("2026-06-01T09:00:00.000Z"),
      operationalEndAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    // Provider tries to pass a different interval — it must be ignored.
    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID, START, END);

    expect(result).toEqual({ ok: true });
    // The update carries NO operational interval — the slot-derived one stands untouched.
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { vehicleId: VEHICLE_ID, vehicleSnapshot: SNAP },
    });
  });

  // --- BOOKING-CONFLICT-1B -----------------------------------------------------

  const SLOT_START = new Date("2026-06-01T09:00:00.000Z");
  const SLOT_END = new Date("2026-06-01T12:00:00.000Z");
  const SLOT_BASED_BOOKING = {
    id: BOOKING_ID, providerId: "provider-1", serviceId: "service-1", seats: 4, status: "PENDING_PROVIDER",
    priceSnapshotAmount: { toString: () => "15" }, priceSnapshotCurrency: "OMR",
    operationalStartAt: SLOT_START, operationalEndAt: SLOT_END, // slot-derived interval
  };

  function primeVehicleAcceptance(booking: unknown) {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue(booking);
    canAcceptBookingMock.mockReturnValue(true);
    resolveVehicleAssignmentMock.mockResolvedValue({ ok: true, vehicleId: VEHICLE_ID, snapshot: SNAP });
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);
  }

  it("reserves the vehicle for the SLOT-DERIVED interval (equal to the booking's operational window)", async () => {
    primeVehicleAcceptance(SLOT_BASED_BOOKING);

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: true });
    // The reservation window is exactly the booking's operational interval, not the (ignored)
    // provider-supplied schedule — and it is committed inside the acceptance transaction.
    expect(reserveVehicleMock).toHaveBeenCalledWith(
      expect.anything(),
      { bookingId: BOOKING_ID, vehicleId: VEHICLE_ID, startsAt: SLOT_START, endsAt: SLOT_END }
    );
  });

  it("reserves the vehicle for the PROVIDER-SUPPLIED interval on a slotless booking", async () => {
    primeVehicleAcceptance(SLOTLESS_BOOKING);

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID, START, END);

    expect(result).toEqual({ ok: true });
    expect(reserveVehicleMock).toHaveBeenCalledWith(
      expect.anything(),
      { bookingId: BOOKING_ID, vehicleId: VEHICLE_ID, startsAt: START, endsAt: END }
    );
  });

  it("VEHICLE_BUSY: an overlapping reservation aborts acceptance — no vehicle write, no hook", async () => {
    primeVehicleAcceptance(SLOT_BASED_BOOKING);
    reserveVehicleMock.mockResolvedValue({ ok: false, reason: "VEHICLE_BUSY" });

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    // The transaction threw and rolled back: booking stays PENDING_PROVIDER (never written to
    // CONFIRMED in DB), no vehicleId/snapshot write, and the post-commit hook never fired.
    expect(result).toEqual({ ok: false, error: "VEHICLE_BUSY" });
    expect(bookingUpdateMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  it("ALREADY_RESERVED (stale/double accept) maps to BOOKING_STATE_CONFLICT, never a second reservation", async () => {
    primeVehicleAcceptance(SLOT_BASED_BOOKING);
    reserveVehicleMock.mockResolvedValue({ ok: false, reason: "ALREADY_RESERVED" });

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_STATE_CONFLICT" });
    expect(bookingUpdateMock).not.toHaveBeenCalled();
    expect(dispatchLifecycleHookMock).not.toHaveBeenCalled();
  });

  it("INVALID_INTERVAL from the reservation primitive maps defensively to INVALID_SCHEDULE", async () => {
    primeVehicleAcceptance(SLOT_BASED_BOOKING);
    reserveVehicleMock.mockResolvedValue({ ok: false, reason: "INVALID_INTERVAL" });

    const result = await acceptBooking(BOOKING_ID, VEHICLE_ID);

    expect(result).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
    expect(bookingUpdateMock).not.toHaveBeenCalled();
  });

  it("a non-vehicle acceptance never reserves anything (unchanged path)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID, providerId: "provider-1", serviceId: "service-1", seats: 1, status: "PENDING_PROVIDER",
      priceSnapshotAmount: { toString: () => "15" }, priceSnapshotCurrency: "OMR",
    });
    canAcceptBookingMock.mockReturnValue(true);
    // default resolveVehicleAssignmentMock → { vehicleId: null }
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue(null);
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    expect(reserveVehicleMock).not.toHaveBeenCalled();
  });
});

// DOWNSTREAM MONEY ALIGNMENT — the resolved effective total drives commission + Payment + gateway.
describe("acceptBooking — money alignment", () => {
  it("TOTALIZED booking: commission + Payment + gateway all use the TOTAL (50), not the unit (10)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: "50",
    });
    canAcceptBookingMock.mockReturnValue(true);
    transitionBookingMock.mockResolvedValue({ bookingId: BOOKING_ID, toStatus: "CONFIRMED" });
    commissionFindFirstMock.mockResolvedValue({ providerId: "provider-1", tier: "TIER_12", status: "ACTIVE" });
    bookingUpdateMock.mockResolvedValue({});
    paymentCreateMock.mockResolvedValue({});
    dispatchLifecycleHookMock.mockResolvedValue(undefined);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: true });
    // Commission on the TOTAL: 50 × 12% = 6.00.
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { commissionSnapshotTier: "TIER_12", commissionSnapshotAmount: "6.00" },
    });
    const paymentData = (paymentCreateMock.mock.calls[0]![0]).data;
    expect((paymentData.amount).toString()).toBe("50");
    expect(paymentData.currency).toBe("OMR");
  });

  it("INVALID snapshot (total present, pricingUnit NULL) FAILS CLOSED — no transition, no Payment, no commission", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    bookingFindUniqueMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: "provider-1",
      status: "PENDING_PROVIDER",
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: "50",
    });
    canAcceptBookingMock.mockReturnValue(true);

    const result = await acceptBooking(BOOKING_ID);

    expect(result).toEqual({ ok: false, error: "BOOKING_PRICING_INVALID" });
    expect(transitionBookingMock).not.toHaveBeenCalled();
    expect(paymentCreateMock).not.toHaveBeenCalled();
    expect(bookingUpdateMock).not.toHaveBeenCalled();
  });
});
