import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getPaymentWebhookVerifier } = await import("./get-payment-webhook-verifier");
const { noOpPaymentWebhookVerifier } = await import("./providers/no-op-payment-webhook-verifier");
const { stripePaymentWebhookVerifier } = await import("./providers/stripe-payment-webhook-verifier");

// Phase 2.19 (Payment Webhook Security Foundation) — regression tests
// for the webhook verifier factory: mirrors
// get-payment-gateway-provider.test.ts's reserved-key pattern exactly.
//
// Phase 2.22 (First Payment Provider) — STRIPE moved from "reserved
// future" to a real resolved verifier; its own test replaces the
// reserved-key case that used to cover it.
//
// Phase 2.22A (Provider Selection Architecture Refinement) — an
// explicit key still wins over configuration, but an OMITTED key now
// resolves from PAYMENT_PROVIDER.

afterEach(() => {
  delete process.env.PAYMENT_PROVIDER;
});

describe("getPaymentWebhookVerifier", () => {
  it("resolves NONE by reference", () => {
    expect(getPaymentWebhookVerifier("NONE")).toBe(noOpPaymentWebhookVerifier);
  });

  it("resolves STRIPE by reference", () => {
    expect(getPaymentWebhookVerifier("STRIPE")).toBe(stripePaymentWebhookVerifier);
  });

  it("defaults to NONE when no key is passed and PAYMENT_PROVIDER is unset", () => {
    expect(getPaymentWebhookVerifier()).toBe(noOpPaymentWebhookVerifier);
  });

  it.each(["PAYPAL", "OMANNET", "APPLE_PAY", "GOOGLE_PAY", "BANK_API"] as const)(
    "throws a clear, distinct error for the reserved %s key",
    (key) => {
      expect(() => getPaymentWebhookVerifier(key)).toThrow(/reserved future payment webhook verifier/);
    }
  );

  it("throws for a genuinely unknown key", () => {
    expect(() => getPaymentWebhookVerifier("NOT_A_REAL_KEY" as never)).toThrow(/unknown payment webhook verifier key/);
  });
});

describe("getPaymentWebhookVerifier — provider resolution from configuration", () => {
  it("resolves STRIPE when PAYMENT_PROVIDER=STRIPE and no explicit key is passed", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentWebhookVerifier()).toBe(stripePaymentWebhookVerifier);
  });

  it("resolves NONE when PAYMENT_PROVIDER=NONE", () => {
    process.env.PAYMENT_PROVIDER = "NONE";
    expect(getPaymentWebhookVerifier()).toBe(noOpPaymentWebhookVerifier);
  });

  it("an explicit key always overrides PAYMENT_PROVIDER", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentWebhookVerifier("NONE")).toBe(noOpPaymentWebhookVerifier);
  });
});
