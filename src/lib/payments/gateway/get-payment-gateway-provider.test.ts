import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getPaymentGatewayProvider } = await import("./get-payment-gateway-provider");
const { noOpPaymentGatewayProvider } = await import("./providers/no-op-payment-gateway-provider");
const { stripePaymentGatewayProvider } = await import("./providers/stripe-payment-gateway-provider");

// Phase 2.15 (Payment Gateway Abstraction Foundation) — regression
// tests for the payment gateway factory: mirrors
// get-signature-provider.test.ts's reserved-key pattern exactly.
//
// Phase 2.22 (First Payment Provider) — STRIPE moved from "reserved
// future" to a real resolved provider; its own test replaces the
// reserved-key case that used to cover it.
//
// Phase 2.22A (Provider Selection Architecture Refinement) — an
// explicit key still wins over configuration (tests below), but an
// OMITTED key now resolves from PAYMENT_PROVIDER — see the "provider
// resolution from configuration" describe block.

afterEach(() => {
  delete process.env.PAYMENT_PROVIDER;
});

describe("getPaymentGatewayProvider", () => {
  it("resolves NONE by reference", () => {
    expect(getPaymentGatewayProvider("NONE")).toBe(noOpPaymentGatewayProvider);
  });

  it("resolves STRIPE by reference", () => {
    expect(getPaymentGatewayProvider("STRIPE")).toBe(stripePaymentGatewayProvider);
  });

  it("defaults to NONE when no key is passed and PAYMENT_PROVIDER is unset", () => {
    expect(getPaymentGatewayProvider()).toBe(noOpPaymentGatewayProvider);
  });

  it.each(["PAYPAL", "OMANNET", "APPLE_PAY", "GOOGLE_PAY", "BANK_API"] as const)(
    "throws a clear, distinct error for the reserved %s key",
    (key) => {
      expect(() => getPaymentGatewayProvider(key)).toThrow(/reserved future payment gateway/);
    }
  );

  it("throws for a genuinely unknown key", () => {
    expect(() => getPaymentGatewayProvider("NOT_A_REAL_KEY" as never)).toThrow(/unknown payment gateway provider key/);
  });
});

describe("getPaymentGatewayProvider — provider resolution from configuration", () => {
  it("resolves STRIPE when PAYMENT_PROVIDER=STRIPE and no explicit key is passed", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentGatewayProvider()).toBe(stripePaymentGatewayProvider);
  });

  it("resolves NONE when PAYMENT_PROVIDER=NONE", () => {
    process.env.PAYMENT_PROVIDER = "NONE";
    expect(getPaymentGatewayProvider()).toBe(noOpPaymentGatewayProvider);
  });

  it("an explicit key always overrides PAYMENT_PROVIDER", () => {
    process.env.PAYMENT_PROVIDER = "STRIPE";
    expect(getPaymentGatewayProvider("NONE")).toBe(noOpPaymentGatewayProvider);
  });
});
