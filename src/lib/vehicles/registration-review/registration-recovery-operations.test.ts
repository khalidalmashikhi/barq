import { describe, it, expect, vi, beforeEach } from "vitest";
import { REGISTRATION_PARSER_VERSION as CURRENT } from "@/lib/vehicles/registration-extraction/constants";

// The provider operations of the 2026-10-09 recovery: "Read document again" (LOCAL re-read of a
// stale reading) and "Complete automatic reading" (consent-gated completion), plus the consent
// decision that leads into the completion. Owner-scoping, locking, draft re-binding, audit and
// code mapping — the extraction service itself is proven in registration-recovery.test.ts.

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const assetFindFirst = vi.fn();
const extFindUnique = vi.fn();
const confUpdateMany = vi.fn();
const tx = { vehicleRegistrationConfirmation: { updateMany: (...a: unknown[]) => confUpdateMany(...a) } };
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
    vehicleRegistrationExtraction: { findUnique: (...a: unknown[]) => extFindUnique(...a) },
    $transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  },
}));
const runExtraction = vi.fn();
const runCompletion = vi.fn();
vi.mock("@/lib/vehicles/registration-extraction/extract-registration-service", () => ({
  runVehicleRegistrationExtraction: (...a: unknown[]) => runExtraction(...a),
  runRegistrationCompletion: (...a: unknown[]) => runCompletion(...a),
}));

const { rereadRegistrationDocument } = await import("./reread-registration");
const { completeRegistrationReading } = await import("./complete-registration-reading");

const VEH = "22222222-2222-2222-2222-222222222222";
function asset(extraction: Record<string, unknown> | null, confirmations: unknown[] = []) {
  return {
    id: VEH,
    documents: [{ id: "doc-1", registrationExtraction: extraction && { status: "NEEDS_REVIEW", failureCode: null, documentSha256: "sha-1", parserVersion: "1.1.0", processingExpiresAt: null, ...extraction }, registrationConfirmations: confirmations }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "user-1" }, provider: { id: "prov-1" } });
  auditMock.mockResolvedValue(undefined);
  confUpdateMany.mockResolvedValue({ count: 1 });
  runExtraction.mockResolvedValue({ ok: true, extractionId: "ext-1", status: "NEEDS_REVIEW", failureCode: null, idempotent: false });
  extFindUnique.mockResolvedValue({ documentSha256: "sha-1", parserVersion: CURRENT });
});

describe("rereadRegistrationDocument — 'Read document again'", () => {
  it("owner-scoped: the asset is looked up under the SESSION provider; a foreign id is non-enumerating", async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(assetFindFirst.mock.calls[0]![0].where).toMatchObject({ id: VEH, providerId: "prov-1", assetType: "VEHICLE" });
    expect(await rereadRegistrationDocument("not-a-uuid")).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(runExtraction).not.toHaveBeenCalled();
  });

  it("a stale reading is re-read LOCALLY ONLY (localOnly flag), audited with versions only", async () => {
    assetFindFirst.mockResolvedValue(asset({}));
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: true, changed: true });
    expect(runExtraction).toHaveBeenCalledWith({ assetDocumentId: "doc-1", actorUserId: "user-1" }, undefined, { localOnly: true });
    const audit = auditMock.mock.calls[0]![0] as { action: string; actorType: string; newValue: Record<string, unknown> };
    expect(audit).toMatchObject({ action: "vehicle.registration_reread_requested", actorType: "PROVIDER", actorId: "prov-1" });
    expect(audit.newValue).toEqual({ previousParserVersion: "1.1.0", parserVersion: CURRENT, changed: true, externalCall: false, draftRebound: false, outcomeStatus: "NEEDS_REVIEW" });
  });

  it("6. an already-CURRENT reading is answered without any work (reload / second click)", async () => {
    assetFindFirst.mockResolvedValue(asset({ parserVersion: CURRENT }));
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: true, changed: false });
    expect(runExtraction).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("the provider's DRAFT on the same bytes is RE-BOUND to the new version (their entries stay theirs); a different document's draft is not", async () => {
    assetFindFirst.mockResolvedValue(asset({}, [{ id: "conf-1", status: "DRAFT", boundDocumentSha256: "sha-1", boundParserVersion: "1.1.0" }]));
    await rereadRegistrationDocument(VEH);
    expect(confUpdateMany).toHaveBeenCalledWith({
      where: { id: "conf-1", status: "DRAFT", boundDocumentSha256: "sha-1", boundParserVersion: "1.1.0" },
      data: { boundParserVersion: CURRENT, version: { increment: 1 } },
    });
    expect((auditMock.mock.calls[0]![0] as { newValue: { draftRebound: boolean } }).newValue.draftRebound).toBe(true);
    confUpdateMany.mockClear();
    assetFindFirst.mockResolvedValue(asset({}, [{ id: "conf-2", status: "DRAFT", boundDocumentSha256: "sha-OTHER", boundParserVersion: "1.1.0" }]));
    await rereadRegistrationDocument(VEH);
    expect(confUpdateMany).not.toHaveBeenCalled();
  });

  it("a SUBMITTED (locked) claim blocks the re-read", async () => {
    assetFindFirst.mockResolvedValue(asset({}, [{ id: "conf-1", status: "SUBMITTED", boundDocumentSha256: "sha-1", boundParserVersion: "1.1.0" }]));
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "LOCKED" });
    expect(runExtraction).not.toHaveBeenCalled();
  });

  it("no reading yet → EXTRACTION_NOT_READY; service failures map to safe codes", async () => {
    assetFindFirst.mockResolvedValue(asset(null));
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
    assetFindFirst.mockResolvedValue(asset({}));
    runExtraction.mockResolvedValueOnce({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "STORAGE_NOT_CONFIGURED" });
    runExtraction.mockResolvedValueOnce({ ok: false, error: "NOTHING_TO_REREAD" });
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "EXTRACTION_FAILED" });
  });

  it("an audit failure is reported (the deterministic re-read itself is idempotent and harmless)", async () => {
    assetFindFirst.mockResolvedValue(asset({}));
    auditMock.mockRejectedValueOnce(new Error("audit down"));
    expect(await rereadRegistrationDocument(VEH)).toEqual({ ok: false, code: "UNKNOWN_ERROR" });
  });
});

describe("completeRegistrationReading — 'Complete automatic reading'", () => {
  it("owner-scoped, passes the acting user for the call budget, maps outcomes", async () => {
    assetFindFirst.mockResolvedValue(asset({ parserVersion: CURRENT }));
    runCompletion.mockResolvedValueOnce({ ok: true, outcome: "COMPLETED", extractionId: "ext-1" });
    expect(await completeRegistrationReading(VEH)).toEqual({ ok: true, outcome: "COMPLETED" });
    expect(runCompletion).toHaveBeenCalledWith({ assetDocumentId: "doc-1", actorUserId: "user-1" }, undefined);
    expect(assetFindFirst.mock.calls[0]![0].where).toMatchObject({ id: VEH, providerId: "prov-1" });
  });

  it.each([
    ["CONSENT_REQUIRED", "OCR_CONSENT_REQUIRED"],
    ["RESULT_STALE", "RESULT_STALE"],
    ["RATE_LIMITED", "OCR_RATE_LIMITED"],
    ["ATTEMPT_LIMIT", "OCR_ATTEMPT_LIMIT"],
    ["READ_FAILED", "COMPLETION_FAILED"],
    ["NOT_NEEDED", "COMPLETION_NOT_AVAILABLE"],
    ["NOT_APPLICABLE", "COMPLETION_NOT_AVAILABLE"],
    ["OCR_NOT_AVAILABLE", "OCR_NOT_AVAILABLE"],
    ["UNKNOWN_ERROR", "UNKNOWN_ERROR"],
  ])("service %s → %s", async (error, code) => {
    assetFindFirst.mockResolvedValue(asset({ parserVersion: CURRENT }));
    runCompletion.mockResolvedValueOnce({ ok: false, error });
    expect(await completeRegistrationReading(VEH)).toEqual({ ok: false, code });
  });

  it("a locked review cannot be completed; a foreign vehicle is not found", async () => {
    assetFindFirst.mockResolvedValue(asset({ parserVersion: CURRENT }, [{ status: "SUBMITTED", boundDocumentSha256: "sha-1", boundParserVersion: CURRENT }]));
    expect(await completeRegistrationReading(VEH)).toEqual({ ok: false, code: "LOCKED" });
    assetFindFirst.mockResolvedValue(null);
    expect(await completeRegistrationReading(VEH)).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
    expect(runCompletion).not.toHaveBeenCalled();
  });
});
