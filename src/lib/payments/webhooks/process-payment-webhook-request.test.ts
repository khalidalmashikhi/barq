import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.20 (Payment Webhook Pipeline Foundation) — regression tests
// for processPaymentWebhookRequest(), the Composition Root sequencing
// the Verifier, Adapter, and Payment Domain. Each dependency is mocked
// independently so these tests prove ORCHESTRATION only (right calls,
// right order, right short-circuiting, right result mapping) — the real
// unmocked composition is covered separately by
// payment-webhook-pipeline-domain.integration.test.ts.

vi.mock("server-only", () => ({}));

const verifyMock = vi.fn();
const getPaymentWebhookVerifierMock = vi.fn<(key?: unknown) => { key: string; verify: typeof verifyMock }>(
  () => ({ key: "STUB_VERIFIER", verify: verifyMock })
);

vi.mock("./security/get-payment-webhook-verifier", () => ({
  getPaymentWebhookVerifier: (...args: unknown[]) => getPaymentWebhookVerifierMock(...args),
}));

const translateMock = vi.fn();
const getPaymentWebhookAdapterMock = vi.fn<(key?: unknown) => { key: string; translate: typeof translateMock }>(
  () => ({ key: "STUB_ADAPTER", translate: translateMock })
);

vi.mock("./adapters/get-payment-webhook-adapter", () => ({
  getPaymentWebhookAdapter: (...args: unknown[]) => getPaymentWebhookAdapterMock(...args),
}));

const processPaymentWebhookEventMock = vi.fn();

vi.mock("./process-payment-webhook-event", () => ({
  processPaymentWebhookEvent: (...args: unknown[]) => processPaymentWebhookEventMock(...args),
}));

const { processPaymentWebhookRequest } = await import("./process-payment-webhook-request");

const RAW_REQUEST = { headers: { "x-signature": "whatever" }, body: '{"raw":true}' };

afterEach(() => {
  verifyMock.mockReset();
  getPaymentWebhookVerifierMock.mockClear();
  translateMock.mockReset();
  getPaymentWebhookAdapterMock.mockClear();
  processPaymentWebhookEventMock.mockReset();
});

describe("processPaymentWebhookRequest", () => {
  it("returns a VERIFICATION failure and never calls the adapter or domain when verification fails", async () => {
    verifyMock.mockReturnValue({ ok: false, error: "INVALID_SIGNATURE" });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "VERIFICATION", error: "INVALID_SIGNATURE" });
    expect(translateMock).not.toHaveBeenCalled();
    expect(processPaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("returns a TRANSLATION failure and never calls the domain when translation fails", async () => {
    verifyMock.mockReturnValue({ ok: true, payload: { raw: true } });
    translateMock.mockReturnValue({ ok: false, error: "INVALID_PAYLOAD" });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "TRANSLATION", error: "INVALID_PAYLOAD" });
    expect(translateMock).toHaveBeenCalledWith({ raw: true });
    expect(processPaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("returns a PROCESSING failure when the domain rejects the translated event", async () => {
    const canonicalEvent = { providerKey: "STUB", providerEventId: "evt_1", bookingId: "b1", status: "CAPTURED", occurredAt: new Date() };
    verifyMock.mockReturnValue({ ok: true, payload: { raw: true } });
    translateMock.mockReturnValue({ ok: true, event: canonicalEvent });
    processPaymentWebhookEventMock.mockResolvedValue({ ok: false, error: "PAYMENT_NOT_FOUND" });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "PROCESSING", error: "PAYMENT_NOT_FOUND" });
    expect(processPaymentWebhookEventMock).toHaveBeenCalledWith(canonicalEvent);
  });

  it("returns { ok: true, applied: true } when every stage succeeds", async () => {
    verifyMock.mockReturnValue({ ok: true, payload: { raw: true } });
    translateMock.mockReturnValue({ ok: true, event: { status: "CAPTURED" } });
    processPaymentWebhookEventMock.mockResolvedValue({ ok: true, applied: true });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: true, applied: true });
  });

  it("passes through { ok: true, applied: false, reason: ALREADY_PROCESSED } unchanged", async () => {
    verifyMock.mockReturnValue({ ok: true, payload: { raw: true } });
    translateMock.mockReturnValue({ ok: true, event: { status: "CAPTURED" } });
    processPaymentWebhookEventMock.mockResolvedValue({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: true, applied: false, reason: "ALREADY_PROCESSED" });
  });

  it("catches an unexpected throw (e.g. the NONE verifier's configuration error) and returns UNKNOWN_ERROR", async () => {
    verifyMock.mockImplementation(() => {
      throw new Error("no real Payment Webhook Verifier is configured");
    });

    const result = await processPaymentWebhookRequest(RAW_REQUEST);

    expect(result).toEqual({ ok: false, stage: "UNKNOWN", error: "UNKNOWN_ERROR" });
    expect(translateMock).not.toHaveBeenCalled();
    expect(processPaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("passes verifierKey/adapterKey options through to their respective factories", async () => {
    verifyMock.mockReturnValue({ ok: false, error: "MALFORMED_REQUEST" });

    await processPaymentWebhookRequest(RAW_REQUEST, { verifierKey: "STRIPE", adapterKey: "STRIPE" });

    expect(getPaymentWebhookVerifierMock).toHaveBeenCalledWith("STRIPE");
    expect(getPaymentWebhookAdapterMock).not.toHaveBeenCalled();
  });

  it("calls both factories with undefined (their own defaults) when no options are given", async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {} });
    translateMock.mockReturnValue({ ok: false, error: "INVALID_PAYLOAD" });

    await processPaymentWebhookRequest(RAW_REQUEST);

    expect(getPaymentWebhookVerifierMock).toHaveBeenCalledWith(undefined);
    expect(getPaymentWebhookAdapterMock).toHaveBeenCalledWith(undefined);
  });
});
