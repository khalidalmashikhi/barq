import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.21 (Payment Webhook HTTP Endpoint Foundation) — regression
// tests for POST /api/webhooks/payments. Mirrors
// src/app/api/health/route.test.ts's exact style: mock the one real
// dependency (the pipeline), construct a real Request, and assert
// status + body. These tests prove TRANSPORT ONLY — that headers/body
// are read correctly and each pipeline outcome maps to the documented
// HTTP status — never re-testing pipeline/verifier/adapter/domain logic
// itself, which already has its own full coverage.
//
// Phase 2.22 (First Payment Provider) briefly hardcoded verifierKey/
// adapterKey to "STRIPE" here; Phase 2.22A (Provider Selection
// Architecture Refinement) reverted the route to passing no options at
// all — provider selection now lives in the factories themselves, via
// PAYMENT_PROVIDER (see get-payment-gateway-provider.ts's own comment).
// The pass-through assertion below reflects that current, final shape.

vi.mock("server-only", () => ({}));

const processPaymentWebhookRequestMock = vi.fn();

vi.mock("@/lib/payments/webhooks/process-payment-webhook-request", () => ({
  processPaymentWebhookRequest: (...args: unknown[]) => processPaymentWebhookRequestMock(...args),
}));

const { POST } = await import("./route");

function buildRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/payments", {
    method: "POST",
    headers,
    body,
  });
}

afterEach(() => {
  processPaymentWebhookRequestMock.mockReset();
});

describe("POST /api/webhooks/payments", () => {
  it("reads the raw body and lowercased headers, and passes them through unmodified", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: true, applied: true });

    const rawBody = '{"any":"shape"}';
    const response = await POST(buildRequest(rawBody, { "X-Test-Signature": "abc123" }));

    expect(response.status).toBe(200);
    expect(processPaymentWebhookRequestMock).toHaveBeenCalledWith({
      headers: expect.objectContaining({ "x-test-signature": "abc123" }),
      body: rawBody,
    });
  });

  it("returns 200 for { ok: true, applied: true }", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: true, applied: true });

    const response = await POST(buildRequest("{}"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, applied: true });
  });

  it("returns 200 for { ok: true, applied: false, reason: ALREADY_PROCESSED }", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(200);
  });

  it("returns 401 for a VERIFICATION/INVALID_SIGNATURE failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "VERIFICATION", error: "INVALID_SIGNATURE" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(401);
  });

  it("returns 400 for a VERIFICATION/MALFORMED_REQUEST failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "VERIFICATION", error: "MALFORMED_REQUEST" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(400);
  });

  it("returns 400 for a TRANSLATION/INVALID_PAYLOAD failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "TRANSLATION", error: "INVALID_PAYLOAD" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(400);
  });

  it("returns 404 for a PROCESSING/PAYMENT_NOT_FOUND failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "PROCESSING", error: "PAYMENT_NOT_FOUND" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(404);
  });

  it("returns 400 for a PROCESSING/UNSUPPORTED_STATUS failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "PROCESSING", error: "UNSUPPORTED_STATUS" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(400);
  });

  it("returns 400 for a PROCESSING/INVALID_EVENT failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "PROCESSING", error: "INVALID_EVENT" });

    const response = await POST(buildRequest("{}"));

    expect(response.status).toBe(400);
  });

  it("returns 500 for an UNKNOWN/UNKNOWN_ERROR failure", async () => {
    processPaymentWebhookRequestMock.mockResolvedValue({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });

    const response = await POST(buildRequest("{}"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });
  });
});
