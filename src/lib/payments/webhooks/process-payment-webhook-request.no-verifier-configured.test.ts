import { describe, it, expect, vi } from "vitest";

// Phase 2.20 (Payment Webhook Pipeline Foundation) — proves the true
// production default: with NOTHING mocked except @/lib/db, calling
// processPaymentWebhookRequest() with no verifierKey resolves the real
// getPaymentWebhookVerifier() factory default ("NONE"), whose real
// noOpPaymentWebhookVerifier.verify() always throws (Phase 2.19's own
// deliberate design — see that module's comment). The pipeline's own
// outer try/catch converts that into a safe, generic result rather than
// letting it propagate — and, critically, the database is never
// touched, since the Adapter and Payment Domain are never reached.

vi.mock("server-only", () => ({}));

const paymentFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: { findUnique: (...args: unknown[]) => paymentFindUniqueMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({}),
  },
}));

const { processPaymentWebhookRequest } = await import("./process-payment-webhook-request");

describe("processPaymentWebhookRequest with no verifier configured (real default, nothing else mocked)", () => {
  it("fails closed with UNKNOWN_ERROR and never touches the database", async () => {
    const result = await processPaymentWebhookRequest({ headers: {}, body: "{}" });

    expect(result).toEqual({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
