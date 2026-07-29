import { describe, it, expect, vi } from "vitest";

// Phase 2.17 (Payment Webhook Foundation) — regression tests for
// isPaymentWebhookEvent(): the runtime guard every future provider
// adapter's translated payload must pass before it reaches Payment
// domain logic.

vi.mock("server-only", () => ({}));

const { isPaymentWebhookEvent } = await import("./payment-webhook-event");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function validEvent() {
  return {
    providerKey: "NONE",
    providerEventId: "evt_1",
    bookingId: BOOKING_ID,
    status: "CAPTURED",
    occurredAt: new Date(),
  };
}

describe("isPaymentWebhookEvent", () => {
  it("accepts a well-formed event", () => {
    expect(isPaymentWebhookEvent(validEvent())).toBe(true);
  });

  it("accepts every real PaymentStatus value", () => {
    for (const status of ["INITIATED", "CAPTURED", "REFUNDED_PARTIAL", "REFUNDED_FULL", "FAILED"]) {
      expect(isPaymentWebhookEvent({ ...validEvent(), status })).toBe(true);
    }
  });

  it("rejects null and non-object values", () => {
    expect(isPaymentWebhookEvent(null)).toBe(false);
    expect(isPaymentWebhookEvent(undefined)).toBe(false);
    expect(isPaymentWebhookEvent("not-an-event")).toBe(false);
    expect(isPaymentWebhookEvent(42)).toBe(false);
  });

  it("rejects a missing or empty providerKey", () => {
    const withoutKey: Record<string, unknown> = validEvent();
    delete withoutKey.providerKey;
    expect(isPaymentWebhookEvent(withoutKey)).toBe(false);
    expect(isPaymentWebhookEvent({ ...validEvent(), providerKey: "" })).toBe(false);
  });

  it("rejects a missing or empty providerEventId", () => {
    const withoutId: Record<string, unknown> = validEvent();
    delete withoutId.providerEventId;
    expect(isPaymentWebhookEvent(withoutId)).toBe(false);
    expect(isPaymentWebhookEvent({ ...validEvent(), providerEventId: "" })).toBe(false);
  });

  it("rejects a bookingId that isn't a valid UUID", () => {
    expect(isPaymentWebhookEvent({ ...validEvent(), bookingId: "not-a-uuid" })).toBe(false);
  });

  it("rejects an unrecognized status string", () => {
    expect(isPaymentWebhookEvent({ ...validEvent(), status: "SUCCEEDED" })).toBe(false);
  });

  it("rejects a missing or invalid occurredAt", () => {
    const withoutDate: Record<string, unknown> = validEvent();
    delete withoutDate.occurredAt;
    expect(isPaymentWebhookEvent(withoutDate)).toBe(false);
    expect(isPaymentWebhookEvent({ ...validEvent(), occurredAt: "2026-01-01" })).toBe(false);
    expect(isPaymentWebhookEvent({ ...validEvent(), occurredAt: new Date("invalid") })).toBe(false);
  });
});
