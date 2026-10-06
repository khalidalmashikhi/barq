import { describe, it, expect, vi, beforeEach } from "vitest";

// The provider's decision function: session-derived, owner-scoped, decision WRITTEN BEFORE any
// reading starts, and a decline that starts nothing.

vi.mock("server-only", () => ({}));
const requireApprovedProvider = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProvider(...a) }));
const assetFindFirst = vi.fn();
const txSpy = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => {
      txSpy();
      return cb({ tag: "tx" });
    },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const policyMock = vi.fn();
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => ({ getRegistrationOcrPolicy: () => policyMock() }));
const record = vi.fn();
vi.mock("@/lib/vehicles/registration-extraction/ocr/ocr-consent", async (original) => {
  const real = await original<typeof import("@/lib/vehicles/registration-extraction/ocr/ocr-consent")>();
  return { ...real, recordOcrConsentDecision: (...a: unknown[]) => record(...a) };
});
const analyze = vi.fn();
vi.mock("./run-registration-analysis", () => ({ runRegistrationAnalysis: (...a: unknown[]) => analyze(...a) }));

const { decideRegistrationOcrConsent } = await import("./decide-ocr-consent");
const { OcrConsentInputError } = await import("@/lib/vehicles/registration-extraction/ocr/ocr-consent");

const VEH = "11111111-1111-1111-1111-111111111111";
const SHA = "ab".repeat(32);
const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-v1", inferenceGeo: "us" as const };
const grant = { ownerAuthorizationConfirmed: true, locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProvider.mockResolvedValue({ barqUser: { id: "user-1" }, provider: { id: "prov-1", status: "APPROVED" } });
  policyMock.mockReturnValue(POLICY);
  assetFindFirst.mockResolvedValue({ id: VEH, documents: [{ id: "doc-1", registrationExtraction: { documentSha256: SHA } }] });
  record.mockResolvedValue({ id: "consent-1" });
  analyze.mockResolvedValue({ ok: true, status: "PROCESSING", failureLabelKey: null });
});

describe("decideRegistrationOcrConsent", () => {
  it("an invalid id → VEHICLE_NOT_FOUND without touching the session or the database", async () => {
    expect(await decideRegistrationOcrConsent("nope", "GRANTED", grant)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(requireApprovedProvider).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("automatic reading not configured here → OCR_NOT_AVAILABLE; nothing is recorded (there is nothing to consent to)", async () => {
    policyMock.mockReturnValue(null);
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: false, code: "OCR_NOT_AVAILABLE" });
    expect(record).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("a foreign or missing vehicle → VEHICLE_NOT_FOUND (owner-scoped query); a shell without a document → DOCUMENT_NOT_FOUND", async () => {
    assetFindFirst.mockResolvedValueOnce(null);
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(assetFindFirst.mock.calls[0]![0].where).toMatchObject({ id: VEH, providerId: "prov-1", assetType: "VEHICLE" });
    assetFindFirst.mockResolvedValueOnce({ id: VEH, documents: [] });
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: false, code: "DOCUMENT_NOT_FOUND" });
    expect(record).not.toHaveBeenCalled();
  });

  it("GRANTED: the decision row (provider + signed-in user + setup + document + notice) is written in a transaction FIRST, then the reading starts", async () => {
    const order: string[] = [];
    record.mockImplementation(async () => (order.push("record"), { id: "consent-1" }));
    analyze.mockImplementation(async () => (order.push("analyze"), { ok: true, status: "PROCESSING", failureLabelKey: null }));
    const res = await decideRegistrationOcrConsent(VEH, "GRANTED", grant);
    expect(res).toEqual({ ok: true, decision: "GRANTED", analysis: { ok: true, status: "PROCESSING", failureLabelKey: null } });
    expect(order).toEqual(["record", "analyze"]);
    expect(txSpy).toHaveBeenCalledTimes(1);
    const [tx, input, policy] = record.mock.calls[0] as [unknown, Record<string, unknown>, unknown];
    expect(tx).toEqual({ tag: "tx" });
    expect(input).toEqual({ providerId: "prov-1", userId: "user-1", assetId: VEH, assetDocumentId: "doc-1", documentSha256: SHA, decision: "GRANTED", ownerAuthorizationConfirmed: true, locale: "en" });
    expect(policy).toBe(POLICY);
    expect(analyze).toHaveBeenCalledWith(VEH);
  });

  it("GRANTED before the stored bytes have been hashed (no extraction row yet) → EXTRACTION_NOT_READY; a DECLINE needs no hash", async () => {
    assetFindFirst.mockResolvedValue({ id: VEH, documents: [{ id: "doc-1", registrationExtraction: null }] });
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
    expect(record).not.toHaveBeenCalled();
    expect(await decideRegistrationOcrConsent(VEH, "DECLINED", { ownerAuthorizationConfirmed: false, locale: "en" })).toMatchObject({ ok: true, decision: "DECLINED" });
    expect(record.mock.calls[0]![1]).toMatchObject({ documentSha256: null });
  });

  it("DECLINED: recorded, and NO reading is started", async () => {
    expect(await decideRegistrationOcrConsent(VEH, "DECLINED", { ownerAuthorizationConfirmed: false, locale: "ar" })).toEqual({ ok: true, decision: "DECLINED", analysis: null });
    expect(record.mock.calls[0]![1]).toMatchObject({ decision: "DECLINED", ownerAuthorizationConfirmed: false, locale: "ar" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("GRANTED without the attestation → OWNER_AUTHORIZATION_REQUIRED; no reading", async () => {
    record.mockRejectedValue(new OcrConsentInputError("OWNER_AUTHORIZATION_REQUIRED"));
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", { ownerAuthorizationConfirmed: false, locale: "en" })).toEqual({ ok: false, code: "OWNER_AUTHORIZATION_REQUIRED" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("the attestation flag is coerced: only `true` counts", async () => {
    await decideRegistrationOcrConsent(VEH, "GRANTED", { ownerAuthorizationConfirmed: "yes" as unknown as boolean, locale: "en" });
    expect(record.mock.calls[0]![1]).toMatchObject({ ownerAuthorizationConfirmed: false });
  });

  it("an unsupported language → INVALID_INPUT; a database failure while writing → UNKNOWN_ERROR — in both cases no reading starts", async () => {
    record.mockRejectedValueOnce(new OcrConsentInputError("INVALID_LOCALE"));
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", { ...grant, locale: "xx" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    record.mockRejectedValueOnce(new Error("connection reset while writing consent"));
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("a reading that fails AFTER consent leaves the GRANTED decision in place and reports the outcome (never undoes the consent)", async () => {
    analyze.mockRejectedValue(new Error("engine exploded"));
    expect(await decideRegistrationOcrConsent(VEH, "GRANTED", grant)).toEqual({ ok: true, decision: "GRANTED", analysis: { ok: false, code: "EXTRACTION_FAILED" } });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("auth errors propagate to the action adapter (which maps them) — the function itself never swallows them", async () => {
    requireApprovedProvider.mockRejectedValue(new Error("UNAUTHENTICATED"));
    await expect(decideRegistrationOcrConsent(VEH, "GRANTED", grant)).rejects.toThrow("UNAUTHENTICATED");
  });
});
