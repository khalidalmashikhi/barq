import { describe, it, expect, vi, beforeEach } from "vitest";

// The provider's decision about EXTERNAL processing of ONE registration document: how the latest
// row is classified against the current notice, what a decision row records, and what can never be
// written. Real PostgreSQL behaviour (scoping, SET NULL survival, the gate in the service) is proven
// in registration-ocr.dbproof.

vi.mock("server-only", () => ({}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));

const { classifyOcrConsent, getEffectiveOcrConsent, isOcrConsentGranted, recordOcrConsentDecision, OcrConsentInputError, NO_CONSENT } = await import("./ocr-consent");

const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-v1", inferenceGeo: "us" as const };
const at = new Date("2026-10-06T10:00:00Z");
const SHA = "ab".repeat(32);
const OTHER_SHA = "cd".repeat(32);
const granted = (over: Record<string, unknown> = {}) => ({ decision: "GRANTED" as const, policyVersion: "2026-10-v1", processor: "anthropic", documentSha256: SHA, createdAt: at, ...over });

describe("classifyOcrConsent — the latest decision against the CURRENT notice", () => {
  it("no row → NONE (nothing may be sent)", () => {
    expect(classifyOcrConsent(null, POLICY, SHA)).toEqual(NO_CONSENT);
    expect(isOcrConsentGranted(classifyOcrConsent(null, POLICY, SHA))).toBe(false);
  });
  it("no notice configured → NONE even if a GRANTED row exists (there is nothing to be granted for)", () => {
    expect(classifyOcrConsent(granted(), null, SHA)).toEqual(NO_CONSENT);
  });
  it("GRANTED for the current notice, processor and these exact bytes → GRANTED", () => {
    const c = classifyOcrConsent(granted(), POLICY, SHA);
    expect(c).toEqual({ state: "GRANTED", policyVersion: "2026-10-v1", decidedAt: at });
    expect(isOcrConsentGranted(c)).toBe(true);
  });
  it("GRANTED for an OLDER notice version → STALE (fresh consent required, nothing may be sent)", () => {
    const c = classifyOcrConsent(granted({ policyVersion: "2026-09-v0" }), POLICY, SHA);
    expect(c.state).toBe("STALE");
    expect(isOcrConsentGranted(c)).toBe(false);
  });
  it("GRANTED for another PROCESSOR → STALE (the notice named someone else)", () => {
    expect(classifyOcrConsent(granted({ processor: "other-vendor" }), POLICY, SHA).state).toBe("STALE");
  });
  it("GRANTED for OTHER BYTES (the document was replaced since) → NONE: a decision about another document", () => {
    expect(classifyOcrConsent(granted(), POLICY, OTHER_SHA)).toEqual(NO_CONSENT);
    expect(classifyOcrConsent(granted({ documentSha256: null }), POLICY, SHA)).toEqual(NO_CONSENT);
    expect(classifyOcrConsent(granted(), POLICY, null)).toEqual(NO_CONSENT); // current bytes unknown → never "granted"
  });
  it("DECLINED → DECLINED regardless of version or bytes (the latest word is the provider's no)", () => {
    for (const policyVersion of ["2026-10-v1", "2026-09-v0"]) {
      const c = classifyOcrConsent({ decision: "DECLINED", policyVersion, processor: "anthropic", documentSha256: null, createdAt: at }, POLICY, OTHER_SHA);
      expect(c.state).toBe("DECLINED");
      expect(isOcrConsentGranted(c)).toBe(false);
    }
  });
});

describe("getEffectiveOcrConsent — scoped to ONE document of ONE provider", () => {
  const findFirst = vi.fn();
  const db = { vehicleRegistrationOcrConsent: { findFirst: (...a: unknown[]) => findFirst(...a) } } as never;
  beforeEach(() => findFirst.mockReset());

  it("queries the LATEST row for exactly (documentId, providerId) — never another provider's or document's", async () => {
    findFirst.mockResolvedValue(granted());
    const c = await getEffectiveOcrConsent(db, { providerId: "prov-1", assetDocumentId: "doc-1", documentSha256: SHA }, POLICY);
    expect(c.state).toBe("GRANTED");
    const args = findFirst.mock.calls[0]![0] as { where: unknown; orderBy: unknown; select: Record<string, boolean> };
    expect(args.where).toEqual({ assetDocumentId: "doc-1", providerId: "prov-1" });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(Object.keys(args.select).sort()).toEqual(["createdAt", "decision", "documentSha256", "policyVersion", "processor"]); // never a document value — there is none to select
  });
  it("the same GRANTED row does not cover the bytes of a replacement", async () => {
    findFirst.mockResolvedValue(granted());
    expect((await getEffectiveOcrConsent(db, { providerId: "prov-1", assetDocumentId: "doc-1", documentSha256: OTHER_SHA }, POLICY)).state).toBe("NONE");
  });
  it("without a notice it does not even query", async () => {
    expect(await getEffectiveOcrConsent(db, { providerId: "prov-1", assetDocumentId: "doc-1", documentSha256: SHA }, null)).toEqual(NO_CONSENT);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("recordOcrConsentDecision — durable proof, append-only, metadata only", () => {
  const create = vi.fn();
  const tx = { vehicleRegistrationOcrConsent: { create: (...a: unknown[]) => create(...a) } } as never;
  const input = { providerId: "prov-1", userId: "user-1", assetId: "asset-1", assetDocumentId: "doc-1", documentSha256: SHA, decision: "GRANTED" as const, ownerAuthorizationConfirmed: true, locale: "ar" };
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "consent-1" });
    auditMock.mockReset().mockResolvedValue(undefined);
  });

  it("GRANTED writes who / what / which notice / attestation, and the disclosed geography; the audit carries the same metadata", async () => {
    expect(await recordOcrConsentDecision(tx, input, POLICY)).toEqual({ id: "consent-1" });
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({
      providerId: "prov-1",
      userId: "user-1",
      assetId: "asset-1",
      assetDocumentId: "doc-1",
      documentSha256: SHA,
      decision: "GRANTED",
      policyVersion: "2026-10-v1",
      processor: "anthropic",
      purpose: "VEHICLE_REGISTRATION_READING",
      inferenceGeo: "us",
      locale: "ar",
      ownerAuthorizationConfirmed: true,
    });
    expect(auditMock).toHaveBeenCalledTimes(1);
    const [event, usedTx] = auditMock.mock.calls[0] as [{ action: string; actorType: string; actorId: string; entityType: string; entityId: string; newValue: Record<string, unknown> }, unknown];
    expect(usedTx).toBe(tx); // same transaction as the row
    expect(event).toMatchObject({ action: "vehicle.registration_ocr_consent_granted", actorType: "PROVIDER", actorId: "prov-1", entityType: "Vehicle", entityId: "asset-1" });
    expect(event.newValue).toEqual({ decision: "GRANTED", policyVersion: "2026-10-v1", processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", inferenceGeo: "us", locale: "ar", ownerAuthorizationConfirmed: true, consentId: "consent-1" });
  });

  it("DECLINED needs no attestation, records no geography, and is audited as a decline", async () => {
    await recordOcrConsentDecision(tx, { ...input, decision: "DECLINED", ownerAuthorizationConfirmed: false }, POLICY);
    expect((create.mock.calls[0]![0] as { data: Record<string, unknown> }).data).toMatchObject({ decision: "DECLINED", inferenceGeo: null, documentSha256: null, ownerAuthorizationConfirmed: false, policyVersion: "2026-10-v1" });
    expect((auditMock.mock.calls[0]![0] as { action: string }).action).toBe("vehicle.registration_ocr_consent_declined");
  });

  it("GRANTED WITHOUT the owner/authorized attestation → nothing is written, nothing is audited", async () => {
    await expect(recordOcrConsentDecision(tx, { ...input, ownerAuthorizationConfirmed: false }, POLICY)).rejects.toBeInstanceOf(OcrConsentInputError);
    await expect(recordOcrConsentDecision(tx, { ...input, ownerAuthorizationConfirmed: "true" as unknown as boolean }, POLICY)).rejects.toMatchObject({ reason: "OWNER_AUTHORIZATION_REQUIRED" });
    expect(create).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("GRANTED without the hash of the stored bytes → nothing is written (there is nothing to bind the decision to)", async () => {
    await expect(recordOcrConsentDecision(tx, { ...input, documentSha256: null }, POLICY)).rejects.toMatchObject({ reason: "DOCUMENT_HASH_REQUIRED" });
    await expect(recordOcrConsentDecision(tx, { ...input, documentSha256: "not-a-hash" }, POLICY)).rejects.toMatchObject({ reason: "DOCUMENT_HASH_REQUIRED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("an unsupported interface language → nothing is written", async () => {
    await expect(recordOcrConsentDecision(tx, { ...input, locale: "xx" }, POLICY)).rejects.toMatchObject({ reason: "INVALID_LOCALE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("the record has no place for document contents, document values, a key or a model id", async () => {
    await recordOcrConsentDecision(tx, input, POLICY);
    const written = JSON.stringify([create.mock.calls[0]![0], auditMock.mock.calls[0]![0]]);
    expect(written).not.toMatch(/claude|sonnet|sk-ant|apiKey|plate|vin|owner[A-Z]?[nN]ame|civil|address|data:image|base64/i);
  });
});
