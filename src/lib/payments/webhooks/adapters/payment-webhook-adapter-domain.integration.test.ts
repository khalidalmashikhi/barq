import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.18 (Payment Webhook Adapter Foundation) — integration test
// composing the full chain this phase's own architecture diagram
// describes: Provider Payload -> Webhook Adapter -> Canonical Payment
// Event -> processPaymentWebhookEvent() -> Database. Same rationale as
// payment-webhook-domain.integration.test.ts (Phase 2.17): every
// existing test in this codebase mocks @/lib/db rather than connecting
// to a real database, and CI runs against a placeholder DATABASE_URL
// with no Postgres behind it.
//
// The payload used here is deliberately wire-shaped (occurredAt as an
// ISO string, exactly as JSON would deliver it) rather than
// pre-typed — this is what proves the adapter is doing real
// translation work, not merely forwarding an already-canonical object.

vi.mock("server-only", () => ({}));

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
        payment: { update: (...args: unknown[]) => paymentUpdateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { getPaymentWebhookAdapter } = await import("./get-payment-webhook-adapter");
const { processPaymentWebhookEvent } = await import("../process-payment-webhook-event");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";

beforeEach(() => {
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("Payment webhook adapter + domain integration (full chain)", () => {
  it("translates a wire-shaped provider payload and applies it through processPaymentWebhookEvent", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const rawPayload = {
      providerKey: "GENERIC",
      providerEventId: "evt_42",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: "2026-01-01T00:00:00.000Z",
    };

    const adapter = getPaymentWebhookAdapter();
    const translated = adapter.translate(rawPayload);

    expect(translated.ok).toBe(true);
    if (!translated.ok) throw new Error("expected translation to succeed");

    const result = await processPaymentWebhookEvent(translated.event);

    expect(result).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "SYSTEM",
        actorId: null,
        action: "payment.webhook_processed",
      }),
    });
  });

  it("stops at the adapter boundary for a malformed payload — processPaymentWebhookEvent is never reached", async () => {
    const adapter = getPaymentWebhookAdapter();
    const translated = adapter.translate({ garbage: true });

    expect(translated).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("a redelivered event for an already-settled Payment is a safe no-op end to end", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "CAPTURED" });

    const adapter = getPaymentWebhookAdapter();
    const translated = adapter.translate({
      providerKey: "GENERIC",
      providerEventId: "evt_43",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: "2026-01-01T00:05:00.000Z",
    });

    if (!translated.ok) throw new Error("expected translation to succeed");
    const result = await processPaymentWebhookEvent(translated.event);

    expect(result).toEqual({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });
});
