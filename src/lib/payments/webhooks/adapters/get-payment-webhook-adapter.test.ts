import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getPaymentWebhookAdapter } = await import("./get-payment-webhook-adapter");
const { genericPaymentWebhookAdapter } = await import("./providers/generic-payment-webhook-adapter");
const { stripePaymentWebhookAdapter } = await import("./providers/stripe-payment-webhook-adapter");

// Phase 2.18 (Payment Webhook Adapter Foundation) — regression tests
// for the webhook adapter factory: mirrors
// get-payment-gateway-provider.test.ts's reserved-key pattern exactly.
//
// Phase 2.22 (First Payment Provider) — STRIPE moved from "reserved
// future" to a real resolved adapter; its own test replaces the
// reserved-key case that used to cover it.
//
// Phase 2.22A (Provider Selection Architecture Refinement) — an
// explicit key still wins over configuration, but an OMITTED key now
// resolves from PAYMENT_PROVIDER, with configuration-level "NONE"
// (and an unset env var) both meaning "use GENERIC" for this factory
// specifically — see get-payment-webhook-adapter.ts's own comment.

afterEach(() => {
  delete process.env.PAYMENT_PROVIDER;
});

describe("getPaymentWebhookAdapter", () => {
  it("resolves GENERIC by reference", () => {
    expect(getPaymentWebhookAdapter("GENERIC")).toBe(genericPaymentWebhookAdapter);
  });

  it("resolves STRIPE by reference", () => {
    expect(getPaymentWebhookAdapter("STRIPE")).toBe(stripePaymentWebhookAdapter);
  });

  it("defaults to GENERIC when no key is passed and PAYMENT_PROVIDER is unset", () => {
    expect(getPaymentWebhookAdapter()).toBe(genericPaymentWebhookAdapter);
  });

  it.each(["PAYPAL", "OMANNET", "APPLE_PAY", "GOOGLE_PAY", "BANK_API"] as const)(
    "throws a clear, distinct error for the reserved %s key",
    (key) => {
      expect(() => getPaymentWebhookAdapter(key)).toThrow(/reserved future payment webhook adapter/);
    }
  );

  it("throws for a genuinely unknown key", () => {
    expect(() => getPaymentWebhookAdapter("NOT_A_REAL_KEY" as never)).toThrow(/unknown payment webhook adapter key/);
  });
});

describe("getPaymentWebhookAdapter — provider resolution from configuration", () => {
  it("resolves STRIPE when PAYMENT_PROVIDER=STRIPE and no explicit key is passed", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentWebhookAdapter()).toBe(stripePaymentWebhookAdapter);
  });

  it("resolves GENERIC when PAYMENT_PROVIDER=NONE (the configuration-level off sentinel)", () => {
    process.env.PAYMENT_PROVIDER = "NONE";
    expect(getPaymentWebhookAdapter()).toBe(genericPaymentWebhookAdapter);
  });

  it("an explicit key always overrides PAYMENT_PROVIDER", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentWebhookAdapter("GENERIC")).toBe(genericPaymentWebhookAdapter);
  });
});
