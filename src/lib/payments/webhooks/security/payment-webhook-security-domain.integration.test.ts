import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaymentWebhookVerifier, RawPaymentWebhookRequest } from "./payment-webhook-verifier";

// Phase 2.19 (Payment Webhook Security Foundation) — integration test
// composing the full chain this phase's own architecture diagram
// describes: Raw HTTP Request -> Webhook Verifier -> Verified Payload ->
// Webhook Adapter -> Canonical Payment Event -> processPaymentWebhookEvent()
// -> Database. Same rationale as the Phase 2.17/2.18 integration tests:
// every existing test in this codebase mocks @/lib/db rather than
// connecting to a real database.
//
// No real verifier exists yet (the only concrete implementation,
// noOpPaymentWebhookVerifier, always throws by design — see its own
// module comment). To demonstrate the full pipeline actually composes,
// this test defines a small stub verifier LOCAL TO THIS TEST FILE ONLY
// (never exported from src/lib) representing what a future real
// verifier's shape would produce — exactly the same technique
// capture-payment.test.ts already uses to mock a controllable gateway
// capture() result without that being a real vendor implementation.
// The second describe block below proves the security-relevant half of
// this phase's own contract: when verification fails (today, always),
// the Adapter and Payment Domain are never reached.

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

const { getPaymentWebhookAdapter } = await import("../adapters/get-payment-webhook-adapter");
const { processPaymentWebhookEvent } = await import("../process-payment-webhook-event");
const { getPaymentWebhookVerifier } = await import("./get-payment-webhook-verifier");
const { noOpPaymentWebhookVerifier } = await import("./providers/no-op-payment-webhook-verifier");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";

// A stub verifier standing in for a future real vendor's implementation
// — not exported anywhere, exists only to prove this phase's pipeline
// seam works end to end.
const stubVerifier: PaymentWebhookVerifier = {
  key: "STUB",
  verify(request: RawPaymentWebhookRequest) {
    if (request.headers["x-stub-signature"] !== "valid") {
      return { ok: false, error: "INVALID_SIGNATURE" };
    }
    return { ok: true, payload: JSON.parse(request.body) };
  },
};

beforeEach(() => {
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("Payment webhook security + adapter + domain integration (full chain)", () => {
  it("verifies, translates, and applies a genuine request end to end", async () => {
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const rawRequest: RawPaymentWebhookRequest = {
      headers: { "x-stub-signature": "valid" },
      body: JSON.stringify({
        providerKey: "GENERIC",
        providerEventId: "evt_100",
        bookingId: BOOKING_ID,
        status: "CAPTURED",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    };

    const verification = stubVerifier.verify(rawRequest);
    expect(verification.ok).toBe(true);
    if (!verification.ok) throw new Error("expected verification to succeed");

    const translation = getPaymentWebhookAdapter().translate(verification.payload);
    expect(translation.ok).toBe(true);
    if (!translation.ok) throw new Error("expected translation to succeed");

    const result = await processPaymentWebhookEvent(translation.event);

    expect(result).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  });

  it("rejects a request with a bad signature at the verifier — the adapter and domain are never reached", async () => {
    const rawRequest: RawPaymentWebhookRequest = {
      headers: { "x-stub-signature": "forged" },
      body: JSON.stringify({
        providerKey: "GENERIC",
        providerEventId: "evt_101",
        bookingId: BOOKING_ID,
        status: "CAPTURED",
        occurredAt: "2026-01-01T00:00:00.000Z",
      }),
    };

    const verification = stubVerifier.verify(rawRequest);

    expect(verification).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("No real verifier is configured yet — the security boundary fails closed", () => {
  it("getPaymentWebhookVerifier().verify() throws before any Adapter or Payment Domain code runs", () => {
    const verifier = getPaymentWebhookVerifier();
    expect(verifier).toBe(noOpPaymentWebhookVerifier);

    expect(() => verifier.verify({ headers: {}, body: "{}" })).toThrow(
      /no real Payment Webhook Verifier is configured/
    );
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
