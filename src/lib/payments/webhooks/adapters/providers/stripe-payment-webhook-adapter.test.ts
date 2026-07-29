import { describe, it, expect, vi } from "vitest";

// Phase 2.22 (First Payment Provider) — regression tests for
// stripePaymentWebhookAdapter.translate(). Pure translation logic, no
// SDK runtime dependency (the file only imports Stripe's types) — these
// tests construct plain Stripe.Event-shaped objects directly, the same
// way generic-payment-webhook-adapter.test.ts exercises its own
// translate() without any network/crypto involved.

vi.mock("server-only", () => ({}));

const { stripePaymentWebhookAdapter } = await import("./stripe-payment-webhook-adapter");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function stripeEvent(overrides: Partial<{ type: string; id: string; created: number; metadata: Record<string, unknown> }> = {}) {
  return {
    id: overrides.id ?? "evt_1",
    type: overrides.type ?? "payment_intent.succeeded",
    created: overrides.created ?? 1735689600,
    data: {
      object: {
        id: "pi_123",
        metadata: overrides.metadata ?? { bookingId: BOOKING_ID },
      },
    },
  };
}

describe("stripePaymentWebhookAdapter", () => {
  it("declares key STRIPE", () => {
    expect(stripePaymentWebhookAdapter.key).toBe("STRIPE");
  });

  it("translates payment_intent.succeeded into a CAPTURED canonical event", () => {
    const result = stripePaymentWebhookAdapter.translate(stripeEvent({ type: "payment_intent.succeeded" }));

    expect(result).toEqual({
      ok: true,
      event: {
        providerKey: "STRIPE",
        providerEventId: "evt_1",
        bookingId: BOOKING_ID,
        status: "CAPTURED",
        occurredAt: new Date(1735689600 * 1000),
      },
    });
  });

  it("translates payment_intent.payment_failed into a FAILED canonical event", () => {
    const result = stripePaymentWebhookAdapter.translate(stripeEvent({ type: "payment_intent.payment_failed" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected translation to succeed");
    expect(result.event.status).toBe("FAILED");
  });

  it("rejects an event type it doesn't know how to translate", () => {
    const result = stripePaymentWebhookAdapter.translate(stripeEvent({ type: "charge.refunded" }));

    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects a PaymentIntent with no bookingId in metadata", () => {
    const result = stripePaymentWebhookAdapter.translate(stripeEvent({ metadata: {} }));

    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects a bookingId in metadata that isn't a valid UUID", () => {
    const result = stripePaymentWebhookAdapter.translate(stripeEvent({ metadata: { bookingId: "not-a-uuid" } }));

    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects null and non-object payloads", () => {
    expect(stripePaymentWebhookAdapter.translate(null)).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    expect(stripePaymentWebhookAdapter.translate("not an event")).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects a payload missing type or data entirely", () => {
    expect(stripePaymentWebhookAdapter.translate({ id: "evt_1" })).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });
});
