import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 2.20 (Payment Webhook Pipeline Foundation) — integration test
// for processPaymentWebhookRequest() using the REAL, unmocked Adapter
// (generic-payment-webhook-adapter.ts) and REAL, unmocked Payment Domain
// (process-payment-webhook-event.ts) against a shared in-memory fake
// Prisma store — same rationale as every prior *-domain.integration.test.ts
// in this codebase. Only the Verifier factory is mocked, returning a
// controllable stub standing in for a future real vendor's verifier,
// exactly the same technique Phase 2.19's own integration test used —
// there is still no real verifier to test against (the NONE verifier
// always throws by design). This proves the pipeline genuinely wires
// the real Adapter and real Payment Domain together, not just that its
// own unit tests' mocks were called correctly.
//
// The true production default (no verifier configured at all) is
// covered separately in
// process-payment-webhook-request.no-verifier-configured.test.ts, which
// mocks nothing but @/lib/db.

vi.mock("server-only", () => ({}));

let stubVerifierResult: { ok: true; payload: unknown } | { ok: false; error: "INVALID_SIGNATURE" | "MALFORMED_REQUEST" };
const verifyMock = vi.fn<(request?: unknown) => typeof stubVerifierResult>(() => stubVerifierResult);

vi.mock("./security/get-payment-webhook-verifier", () => ({
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

const { processPaymentWebhookRequest } = await import("./process-payment-webhook-request");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const PAYMENT_ID = "019f4e4e-8116-7052-b15e-c0ffee000001";

const RAW_REQUEST = { headers: { "x-stub-signature": "valid" }, body: "irrelevant-to-this-test" };

beforeEach(() => {
  paymentFindUniqueMock.mockReset();
  paymentUpdateMock.mockReset();
  auditCreateMock.mockReset();
  verifyMock.mockClear();
});

describe("processPaymentWebhookRequest (real Adapter + real Payment Domain)", () => {
  it("verifies (stub), translates (real), and applies (real) a genuine request end to end", async () => {
    stubVerifierResult = {
      ok: true,
      payload: {
        providerKey: "GENERIC",
        providerEventId: "evt_1",
        bookingId: BOOKING_ID,
        status: "CAPTURED",
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    };
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" });
    paymentUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: true, applied: true });
    expect(paymentUpdateMock).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID },
      data: { status: "CAPTURED", capturedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  });

  it("reports ALREADY_PROCESSED for a redelivered event without writing to the database", async () => {
    stubVerifierResult = {
      ok: true,
      payload: {
        providerKey: "GENERIC",
        providerEventId: "evt_2",
        bookingId: BOOKING_ID,
        status: "CAPTURED",
        occurredAt: "2026-01-01T00:05:00.000Z",
      },
    };
    paymentFindUniqueMock.mockResolvedValue({ id: PAYMENT_ID, status: "CAPTURED" });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });
    expect(paymentUpdateMock).not.toHaveBeenCalled();
  });

  it("stops at TRANSLATION for a payload the real Adapter can't translate — the domain is never reached", async () => {
    stubVerifierResult = { ok: true, payload: { garbage: true } };

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "TRANSLATION", error: "INVALID_PAYLOAD" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });

  it("stops at VERIFICATION for a rejected signature — the real Adapter and Domain are never reached", async () => {
    stubVerifierResult = { ok: false, error: "INVALID_SIGNATURE" };

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "VERIFICATION", error: "INVALID_SIGNATURE" });
    expect(paymentFindUniqueMock).not.toHaveBeenCalled();
  });
});
