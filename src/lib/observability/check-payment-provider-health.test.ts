import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { checkPaymentProviderHealth } = await import("./check-payment-provider-health");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkPaymentProviderHealth", () => {
  it("returns \"NONE\" when PAYMENT_PROVIDER is unset (the safe default)", () => {
    expect(checkPaymentProviderHealth()).toBe("NONE");
  });

  it("returns \"misconfigured\" when PAYMENT_PROVIDER=STRIPE is missing its secrets", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "STRIPE");
    expect(checkPaymentProviderHealth()).toBe("misconfigured");
  });

  it("returns \"STRIPE\" when PAYMENT_PROVIDER=STRIPE has both required secrets", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "STRIPE");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_123");
    expect(checkPaymentProviderHealth()).toBe("STRIPE");
  });

  it("returns \"misconfigured\" for a reserved/unknown provider key", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "PAYPAL");
    expect(checkPaymentProviderHealth()).toBe("misconfigured");
  });
});
