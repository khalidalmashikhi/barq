import { describe, it, expect, vi } from "vitest";

// Phase 2.18 (Payment Webhook Adapter Foundation) — regression tests
// for the generic adapter's translate(): mirrors
// no-op-payment-gateway-provider.test.ts's structure, but this adapter
// has a genuinely working translation path to test (see the module's
// own comment for why, unlike capture()/refund()).

vi.mock("server-only", () => ({}));

const { genericPaymentWebhookAdapter } = await import("./generic-payment-webhook-adapter");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function validPayload() {
  return {
    providerKey: "GENERIC",
    providerEventId: "evt_1",
    bookingId: BOOKING_ID,
    status: "CAPTURED",
    occurredAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("genericPaymentWebhookAdapter", () => {
  it("declares key GENERIC", () => {
    expect(genericPaymentWebhookAdapter.key).toBe("GENERIC");
  });

  it("translates a well-formed payload into a canonical PaymentWebhookEvent, parsing occurredAt into a real Date", () => {
    const result = genericPaymentWebhookAdapter.translate(validPayload());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected translation to succeed");
    expect(result.event).toEqual({
      providerKey: "GENERIC",
      providerEventId: "evt_1",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(result.event.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects null and non-object payloads", () => {
    expect(genericPaymentWebhookAdapter.translate(null)).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    expect(genericPaymentWebhookAdapter.translate("not a payload")).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects a payload missing a required field", () => {
    const payload: Record<string, unknown> = validPayload();
    delete payload.providerKey;
    expect(genericPaymentWebhookAdapter.translate(payload)).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects a bookingId that isn't a valid UUID", () => {
    const result = genericPaymentWebhookAdapter.translate({ ...validPayload(), bookingId: "not-a-uuid" });
    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects an unrecognized status string", () => {
    const result = genericPaymentWebhookAdapter.translate({ ...validPayload(), status: "SUCCEEDED" });
    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects an occurredAt that isn't a parseable date string", () => {
    const result = genericPaymentWebhookAdapter.translate({ ...validPayload(), occurredAt: "not-a-date" });
    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("rejects occurredAt already provided as a Date instance instead of a wire-format string", () => {
    const result = genericPaymentWebhookAdapter.translate({ ...validPayload(), occurredAt: new Date() });
    expect(result).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });
});
