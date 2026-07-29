import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.21 (Payment Webhook HTTP Endpoint Foundation) — integration
// test for POST /api/webhooks/payments using the REAL, unmocked
// pipeline (processPaymentWebhookRequest), REAL Adapter, and REAL
// Payment Domain, against a shared in-memory fake Prisma store — same
// rationale as every prior *-domain.integration.test.ts in this
// codebase. Only the Verifier factory is mocked with a controllable
// stub (there is still no real verifier to test against — the NONE
// verifier always throws by design, see Phase 2.19), the same technique
// Phase 2.20's own integration test already used.
//
// This is the one test in this phase that proves the ENTIRE documented
// architecture end to end, starting from a real HTTP Request object:
// HTTP Route -> processPaymentWebhookRequest() -> Verifier -> Adapter ->
// Canonical Event -> Payment Domain -> Database -> mapped HTTP Response.
//
// Phase 2.22 (First Payment Provider) briefly hardcoded adapterKey to
// "STRIPE" here, reshaping this file's payloads to Stripe.Event shape.
// Phase 2.22A (Provider Selection Architecture Refinement) reverted the
// route to passing no options at all — with PAYMENT_PROVIDER unset in
// this test environment, the REAL adapter this file exercises is once
// again genericPaymentWebhookAdapter (this factory's own default), so
// the payloads below are back to their original GENERIC shape.
// route.stripe.integration.test.ts (Phase 2.22, still current) covers
// the real Stripe Verifier/Adapter pair explicitly, by stubbing
// PAYMENT_PROVIDER=STRIPE for its own scenarios.

vi.mock("server-only", () => ({}));

let stubVerifierResult: { ok: true; payload: unknown } | { ok: false; error: "INVALID_SIGNATURE" | "MALFORMED_REQUEST" };
const verifyMock = vi.fn<(request?: unknown) => typeof stubVerifierResult>(() => stubVerifierResult);

vi.mock("@/lib/payments/webhooks/security/get-payment-webhook-verifier", () => ({
  getPaymentWebhookVerifier: () => ({ key: "STUB", verify: (...args: unknown[]) => verifyMock(...args) }),
}));

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

const { POST } = await import("./route");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";

function buildRequest(body: string) {
  return new Request("http://localhost/api/webhooks/payments", {
    method: "POST",
    headers: { "x-stub-signature": "valid" },
    body,
  });
}

beforeEach(() => {
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  verifyMock.mockClear();
});

describe("POST /api/webhooks/payments (real pipeline + real Adapter + real Payment Domain)", () => {
  it("verifies (stub), translates (real Generic adapter), applies (real), and returns 200 end to end", async () => {
    const genericPayload = {
      providerKey: "GENERIC",
      providerEventId: "evt_1",
      bookingId: BOOKING_ID,
      status: "CAPTURED",
      occurredAt: "2026-01-01T00:00:00.000Z",
    };
    stubVerifierResult = { ok: true, payload: genericPayload };
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const response = await POST(buildRequest(JSON.stringify(genericPayload)));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  });

  it("returns 401 when the stub verifier rejects the signature — the database is never touched", async () => {
    stubVerifierResult = { ok: false, error: "INVALID_SIGNATURE" };

    const response = await POST(buildRequest("irrelevant"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, stage: "VERIFICATION", error: "INVALID_SIGNATURE" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the real Adapter can't translate the verified payload", async () => {
    stubVerifierResult = { ok: true, payload: { garbage: true } };

    const response = await POST(buildRequest("irrelevant"));

    expect(response.status).toBe(400);
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
