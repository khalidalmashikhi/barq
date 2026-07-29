import { describe, it, expect, vi, afterEach } from "vitest";

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

afterEach(() => {
  requireProviderMock.mockReset();
  canAcceptBookingMock.mockReset();
  transitionBookingMock.mockReset();
  dispatchLifecycleHookMock.mockReset();
  bookingFindUniqueMock.mockReset();
  commissionFindFirstMock.mockReset();
  bookingUpdateMock.mockReset();
  paymentCreateMock.mockReset();
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
    expect(bookingUpdateMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { commissionSnapshotTier: "TIER_10", commissionSnapshotAmount: "1.50" },
    });
    expect(paymentCreateMock).toHaveBeenCalledWith({
      data: {
        bookingId: BOOKING_ID,
        amount: { toString: expect.any(Function) },
        currency: "OMR",
        status: "INITIATED",
        providerReference: null,
      },
    });
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

  it("does not create a Payment when the booking somehow has no price snapshot", async () => {
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

    expect(result).toEqual({ ok: true });
    expect(paymentCreateMock).not.toHaveBeenCalled();
  });
});
