import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.22 (First Payment Provider) — regression tests for
// stripePaymentWebhookVerifier. Stripe.webhooks.constructEvent (the
// real SDK's own signature-verification entry point) is mocked — its
// cryptographic internals are Stripe's own SDK's responsibility to
// test, not this codebase's; these tests prove THIS file's own logic:
// missing-secret handling, missing-header handling, and translating the
// SDK's own success/throw outcomes into PaymentWebhookVerificationResult.

vi.mock("server-only", () => ({}));

const constructEventMock = vi.fn();

vi.mock("stripe", () => {
  class MockStripe {
    static webhooks = { constructEvent: (...args: unknown[]) => constructEventMock(...args) };
  }
  return { default: MockStripe };
});

const { stripePaymentWebhookVerifier } = await import("./stripe-payment-webhook-verifier");

const ORIGINAL_ENV = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  constructEventMock.mockReset();
  if (ORIGINAL_ENV === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_ENV;
  }
});

describe("stripePaymentWebhookVerifier", () => {
  it("declares key STRIPE", () => {
    expect(stripePaymentWebhookVerifier.key).toBe("STRIPE");
  });

  it("throws a clear error when STRIPE_WEBHOOK_SECRET is not configured", () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    expect(() => stripePaymentWebhookVerifier.verify({ headers: { "stripe-signature": "t=1,v1=abc" }, body: "{}" })).toThrow(
      /STRIPE_WEBHOOK_SECRET is not configured/
    );
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("returns MALFORMED_REQUEST when the stripe-signature header is missing", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";

    const result = stripePaymentWebhookVerifier.verify({ headers: {}, body: "{}" });

    expect(result).toEqual({ ok: false, error: "MALFORMED_REQUEST" });
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_SIGNATURE when the SDK's constructEvent throws", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const result = stripePaymentWebhookVerifier.verify({
      headers: { "stripe-signature": "t=1,v1=forged" },
      body: '{"id":"evt_1"}',
    });

    expect(result).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("returns the verified event as payload with providerEventId set when verification succeeds", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy";
    const fakeEvent = { id: "evt_1", type: "payment_intent.succeeded" };
    constructEventMock.mockReturnValue(fakeEvent);

    const rawBody = '{"id":"evt_1","type":"payment_intent.succeeded"}';
    const result = stripePaymentWebhookVerifier.verify({
      headers: { "stripe-signature": "t=1,v1=real" },
      body: rawBody,
    });

    expect(constructEventMock).toHaveBeenCalledWith(rawBody, "t=1,v1=real", "whsec_dummy");
    expect(result).toEqual({ ok: true, payload: fakeEvent, providerEventId: "evt_1" });
  });
});
