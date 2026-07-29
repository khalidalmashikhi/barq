import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { noOpPaymentWebhookVerifier } = await import("./no-op-payment-webhook-verifier");

// Phase 2.19 (Payment Webhook Security Foundation) — regression tests
// for the No-Op Payment Webhook Verifier: confirms verify() always
// throws rather than fabricating a verified or rejected outcome,
// mirroring no-op-payment-gateway-provider.test.ts's capture()/refund()
// assertions.

describe("noOpPaymentWebhookVerifier", () => {
  it("declares key NONE", () => {
    expect(noOpPaymentWebhookVerifier.key).toBe("NONE");
  });

  it("verify() throws rather than fabricating a verified or rejected outcome", () => {
    expect(() =>
      noOpPaymentWebhookVerifier.verify({ headers: { "x-signature": "whatever" }, body: '{"status":"CAPTURED"}' })
    ).toThrow(/no real Payment Webhook Verifier is configured/);
  });

  it("throws regardless of the request shape — even an empty request", () => {
    expect(() => noOpPaymentWebhookVerifier.verify({ headers: {}, body: "" })).toThrow(
      /no real Payment Webhook Verifier is configured/
    );
  });
});
