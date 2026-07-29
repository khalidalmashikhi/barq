import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.23 (Payment Gateway Runtime Wiring) — proves capturePayment()
// genuinely reaches the REAL Stripe gateway when PAYMENT_PROVIDER=STRIPE
// is configured, unlike capture-payment.test.ts (which mocks
// getPaymentGatewayProvider entirely and never exercises real gateway
// resolution). Only the "stripe" SDK itself is mocked here (its
// network/crypto internals aren't this codebase's to test) — the real
// getPaymentGatewayProvider() factory and the real
// stripePaymentGatewayProvider are both genuinely exercised.
//
// Phase 2.24 (Provider Reference Persistence) closed the gap this file
// originally proved: Payment now has a stored providerReference column,
// persisted by accept-booking.ts and read back here. The first test
// below is the now-historical case — a Payment with NO stored
// providerReference (e.g. one created before this phase, or under
// PAYMENT_PROVIDER=NONE) still correctly fails against real Stripe with
// the same generic UNKNOWN_ERROR, never a new error state. The second
// test is the new happy path this phase enables: a Payment with a real
// stored providerReference reaches Stripe's real capture() call (SDK
// mocked) and succeeds.
//
// Phase 2.25 (Payment Idempotency & Capture Safety) — paymentUpdateMock
// now mocks tx.payment.updateMany() (an atomic conditional UPDATE
// guarded by status: "INITIATED"), not update(); see
// capture-payment.test.ts's own comment for the full rationale.
//
// Phase 2.26 (Gateway Idempotency) — stripeCaptureMock's assertion now
// includes the deterministic idempotencyKey request option
// stripe-payment-gateway-provider.ts derives from providerReference.

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

const paymentFindUniqueMock = vi.fn();
const paymentUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        payment: { updateMany: (...args: unknown[]) => paymentUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const stripeCaptureMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    paymentIntents = { capture: (...args: unknown[]) => stripeCaptureMock(...args) };
  }
  return { default: MockStripe };
});

const { capturePayment } = await import("./capture-payment");

const PAYMENT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  stripeCaptureMock.mockReset();
  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("capturePayment with the real getPaymentGatewayProvider() factory and PAYMENT_PROVIDER=STRIPE", () => {
  it("a Payment with no stored providerReference is rejected by the real Stripe gateway before ever calling the SDK — returns UNKNOWN_ERROR, not a new error state", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(stripeCaptureMock).not.toHaveBeenCalled();
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("a Payment with a real stored providerReference reaches Stripe's real capture() call and succeeds (Phase 2.24 happy path)", async () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED", providerReference: "pi_123" });
    stripeCaptureMock.mockResolvedValue({ id: "pi_123", status: "succeeded" });
    paymentUpdateMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await capturePayment(PAYMENT_ID);

    expect(result).toEqual({ ok: true });
    expect(stripeCaptureMock).toHaveBeenCalledWith("pi_123", undefined, { idempotencyKey: "barq:payment:capture:pi_123" });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "INITIATED" },
      data: { status: "CAPTURED", capturedAt: expect.any(Date) },
    });
  });
});
