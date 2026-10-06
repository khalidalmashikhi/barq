import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { RegistrationDocumentReader, RegistrationReadResult } from "./ocr/registration-document-reader";

// The OCR TIER of the extraction service against an in-memory stand-in for the extraction row
// (so leases, takeovers and guarded completion behave as they do on the database) and a fake
// reader. Real locking and real concurrency are proven on PostgreSQL in registration-ocr.dbproof.

vi.mock("server-only", () => ({}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
const loggerError = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { error: (...a: unknown[]) => loggerError(...a), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/storage/storage", () => ({ isDocumentStorageConfigured: () => true, downloadPrivateObject: async () => new ArrayBuffer(0) }));

const { runVehicleRegistrationExtraction } = await import("./extract-registration-service");

const BYTES = () => new TextEncoder().encode("synthetic-stored-document-bytes").buffer as ArrayBuffer;
const SHA = createHash("sha256").update(Buffer.from(BYTES())).digest("hex");
const ENGINE = "fake-reader/v1";
const P2002 = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" });
const P2003 = () => new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "5.22.0" });

const GOOD: RegistrationReadResult = {
  ok: true,
  inferenceGeo: "us",
  candidates: {
    plateNumber: [{ text: "T 99001" }],
    makeDescription: [{ text: "Toyota" }],
    model: [{ text: "Testcruiser" }],
    manufactureYear: [{ text: "2020" }],
    licensedPassengerCapacity: [{ text: "7" }],
    vin: [{ text: "TESTV1N0000000001" }],
    licenseExpiry: [{ text: "31/05/2027" }],
  },
};

// ── in-memory extraction row ─────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let row: Row | null;
let reuseHit: Row | null;
let createError: Error | null;
const matches = (where: Row) => !!row && Object.entries(where).every(([k, v]) => (v === null ? row![k] == null : row![k] === v));
const apply = (data: Row) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) row![k] = Number(row![k] ?? 0) + Number((v as { increment: number }).increment);
    else row![k] = v === Prisma.JsonNull ? null : v;
  }
};
const ext = {
  findUnique: vi.fn(async ({ where }: { where: Row }) => (row && (where.assetDocumentId ? row.assetDocumentId === where.assetDocumentId : row.id === where.id) ? { ...row } : null)),
  findFirst: vi.fn(async (args: { where: Row }) => {
    void args; // the call's `where` is asserted by the reuse test
    return reuseHit;
  }),
  create: vi.fn(async ({ data }: { data: Row }) => {
    if (createError) throw createError;
    if (row) throw P2002();
    row = { id: "ext-1", version: 0, attemptCount: 0, lastSucceededAt: null };
    apply(data);
    return { ...row };
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
    if (!matches(where)) return { count: 0 };
    apply(data);
    return { count: 1 };
  }),
};
const docFindUnique = vi.fn();
const db = {
  assetDocument: { findUnique: (...a: unknown[]) => docFindUnique(...a) },
  vehicleRegistrationExtraction: ext,
  $transaction: async (cb: (tx: unknown) => unknown) => cb({ vehicleRegistrationExtraction: ext }),
} as never;

const doc = (mimeType: string) => ({ id: "doc-1", type: "VEHICLE_REGISTRATION", objectKey: "asset-documents/asset-1/vehicle_registration/x.jpg", mimeType, assetId: "asset-1", asset: { assetType: "VEHICLE", providerId: "prov-1" } });

const pdfText = vi.fn();
const read = vi.fn<(input: { bytes: ArrayBuffer; mimeType: string }) => Promise<RegistrationReadResult>>();
const reader: RegistrationDocumentReader = { engine: ENGINE, inferenceGeo: "us", read: (input) => read(input) };
const getReader = vi.fn<() => RegistrationDocumentReader | null>();
// The privacy gate's seams: the processing notice, the provider's recorded decision for THIS
// document, and the external-call budget. Defaults: notice configured, consent GRANTED, budget open.
const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "test-notice-v1", inferenceGeo: "us" as const };
const getPolicy = vi.fn<() => typeof POLICY | null>();
const readConsent = vi.fn<() => Promise<{ state: "GRANTED" | "DECLINED" | "STALE" | "NONE"; policyVersion: string | null; decidedAt: Date | null }>>();
const consumeOcrBudget = vi.fn<() => Promise<"ALLOWED" | "LIMITED">>();
const deps = () => ({ db, extractPdfText: pdfText, downloadPrivateObject: async () => BYTES(), isStorageConfigured: () => true, getReader, getPolicy, readConsent, consumeOcrBudget });
const run = (actorUserId: string | null = "user-1") => runVehicleRegistrationExtraction({ assetDocumentId: "doc-1", actorUserId }, deps());

beforeEach(() => {
  vi.clearAllMocks();
  row = null;
  reuseHit = null;
  createError = null;
  docFindUnique.mockResolvedValue(doc("image/jpeg"));
  pdfText.mockResolvedValue({ ok: false, code: "NO_TEXT_LAYER" });
  read.mockResolvedValue(GOOD);
  getReader.mockReturnValue(reader);
  getPolicy.mockReturnValue(POLICY);
  readConsent.mockResolvedValue({ state: "GRANTED", policyVersion: POLICY.policyVersion, decidedAt: new Date() });
  consumeOcrBudget.mockResolvedValue("ALLOWED");
  auditMock.mockResolvedValue(undefined);
});

describe("tiering — native text first, OCR only as the fallback", () => {
  it("a PDF with a text layer is read LOCALLY: no OCR engine is consulted, nothing leaves the server", async () => {
    docFindUnique.mockResolvedValue(doc("application/pdf"));
    pdfText.mockResolvedValue({ ok: true, pageCount: 1, text: "Plate Number: T 99001\nVehicle Make: Toyota\nModel: Testcruiser\nModel Year: 2020\nNumber of Passengers: 7\nChassis Number: TESTV1N0000000001\nExpiry Date: 31/05/2027" });
    const res = await run();
    expect(res).toMatchObject({ ok: true, status: "EXTRACTED" });
    expect(getReader).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(row).toMatchObject({ source: "NATIVE_PDF_TEXT", ocrEngine: null, status: "EXTRACTED" });
  });

  it.each(["PDF_ENCRYPTED", "PDF_MALFORMED", "PDF_PAGE_LIMIT", "PARSER_TIMEOUT"])("a PDF that fails for a reason OTHER than 'no text layer' (%s) is NOT sent to OCR", async (code) => {
    docFindUnique.mockResolvedValue(doc("application/pdf"));
    pdfText.mockResolvedValue({ ok: false, code });
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: code });
    expect(read).not.toHaveBeenCalled();
  });

  it("a SCANNED (image-only) PDF → OCR, given the ORIGINAL bytes intact (the PDF parser only ever saw a copy)", async () => {
    docFindUnique.mockResolvedValue(doc("application/pdf"));
    pdfText.mockImplementation(async (bytes: ArrayBuffer) => {
      new Uint8Array(bytes).fill(0); // a parser that consumes/detaches its input must not affect what OCR receives
      return { ok: false, code: "NO_TEXT_LAYER" };
    });
    const res = await run();
    expect(res).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    expect(read).toHaveBeenCalledTimes(1);
    const input = read.mock.calls[0]![0];
    expect(input.mimeType).toBe("application/pdf");
    expect(Buffer.from(input.bytes).equals(Buffer.from(BYTES()))).toBe(true);
  });

  it("a PHOTO → OCR directly; the PDF parser is never run on an image", async () => {
    const res = await run();
    expect(res).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(pdfText).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0].mimeType).toBe("image/jpeg");
  });

  it("a stored type the reader cannot take is failed honestly, never sent", async () => {
    docFindUnique.mockResolvedValue(doc("image/gif"));
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "INVALID_FILE_TYPE" });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("no OCR engine configured — fail closed, honestly", () => {
  beforeEach(() => getReader.mockReturnValue(null));

  it("a photo → FAILED / OCR_NOT_CONFIGURED (manual entry); nothing is read or invented", async () => {
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_NOT_CONFIGURED" });
    expect(read).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: "FAILED", fields: null, extractedPlateNumber: null, extractedVin: null });
  });

  it("a scanned PDF keeps its long-standing NO_TEXT_LAYER outcome", async () => {
    docFindUnique.mockResolvedValue(doc("application/pdf"));
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "NO_TEXT_LAYER" });
    expect(read).not.toHaveBeenCalled();
  });

  it("an engine WITHOUT a processing notice (no policy) is as good as no engine: nothing is sent, consent is not even looked up", async () => {
    getReader.mockReturnValue(reader);
    getPolicy.mockReturnValue(null);
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_NOT_CONFIGURED" });
    expect(read).not.toHaveBeenCalled();
    expect(readConsent).not.toHaveBeenCalled();
  });
});

describe("CONSENT — no recorded, current decision for THIS document → zero outbound requests", () => {
  it.each([
    ["no decision", { state: "NONE" as const, policyVersion: null, decidedAt: null }],
    ["the provider DECLINED", { state: "DECLINED" as const, policyVersion: "test-notice-v1", decidedAt: new Date() }],
    ["a GRANTED decision for an OLDER notice (stale)", { state: "STALE" as const, policyVersion: "old-notice", decidedAt: new Date() }],
  ])("%s → FAILED / OCR_CONSENT_REQUIRED, no call, no reuse lookup, no budget spent, nothing invented", async (_label, consent) => {
    readConsent.mockResolvedValue(consent);
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(read).not.toHaveBeenCalled();
    expect(ext.findFirst).not.toHaveBeenCalled(); // an earlier OCR result is not even reused without consent
    expect(consumeOcrBudget).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED", source: "OCR", fields: null, ocrEngine: null, extractedPlateNumber: null });
    // Recorded honestly: nothing was sent, so this is not an "AI-assisted" event.
    expect((auditMock.mock.calls[0]![0] as { newValue: Record<string, unknown> }).newValue).toMatchObject({ failureCode: "OCR_CONSENT_REQUIRED", aiAssisted: false, ocrEngine: null });
    // The decision is looked up for exactly this document and this provider, against the current notice.
    expect(readConsent).toHaveBeenCalledWith(db, { providerId: "prov-1", assetDocumentId: "doc-1", documentSha256: SHA }, POLICY);
  });

  it("a consent LOOKUP FAILURE fails closed: treated as no consent, nothing sent, a category-only log line", async () => {
    readConsent.mockRejectedValue(new Error("db down while reading consent for T 99001"));
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(read).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith("registrationExtraction.consent_lookup_failed", expect.objectContaining({ assetDocumentId: "doc-1" }));
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain("T 99001");
  });

  it("after the provider GRANTS, the very same request path makes exactly one call", async () => {
    readConsent.mockResolvedValueOnce({ state: "NONE", policyVersion: null, decidedAt: null });
    expect(await run()).toMatchObject({ status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED" });
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("ABUSE AND COST CONTROLS around the one external call", () => {
  it("the call budget is consumed by the attempt that holds the lease, for the provider AND the acting user", async () => {
    await run("user-77");
    expect(consumeOcrBudget).toHaveBeenCalledTimes(1);
    expect(consumeOcrBudget).toHaveBeenCalledWith({ providerId: "prov-1", userId: "user-77" });
  });

  it("a replay answered from the stored result spends NO budget", async () => {
    await run();
    await run();
    await run();
    expect(consumeOcrBudget).toHaveBeenCalledTimes(1);
  });

  it("budget LIMITED → the lease is completed as a retryable FAILED / OCR_RATE_LIMITED; NO call is made", async () => {
    consumeOcrBudget.mockResolvedValue("LIMITED");
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_RATE_LIMITED" });
    expect(read).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: "FAILED", failureCode: "OCR_RATE_LIMITED", processingToken: null, fields: null });
    // …and once the budget is open again the retry reads the document.
    consumeOcrBudget.mockResolvedValue("ALLOWED");
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a budget store failure fails CLOSED (no call)", async () => {
    consumeOcrBudget.mockRejectedValue(new Error("limiter down"));
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_RATE_LIMITED" });
    expect(read).not.toHaveBeenCalled();
  });

  it("every lease taken counts against the per-document ceiling; at the ceiling no further call is ever made (OCR_ATTEMPT_LIMIT)", async () => {
    read.mockResolvedValue({ ok: false, code: "OCR_TIMEOUT" });
    for (let i = 1; i <= 5; i++) {
      expect(await run()).toMatchObject({ status: "FAILED", failureCode: "OCR_TIMEOUT" });
      expect(row!.ocrCallCount).toBe(i);
    }
    expect(read).toHaveBeenCalledTimes(5);
    read.mockResolvedValue(GOOD);
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_ATTEMPT_LIMIT" });
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_ATTEMPT_LIMIT" });
    expect(read).toHaveBeenCalledTimes(5); // not 6, not 7
    expect(consumeOcrBudget).toHaveBeenCalledTimes(5);
  });

  it("a pre-gate row (NULL call count) is treated as zero and may still be read", async () => {
    row = { id: "ext-1", assetDocumentId: "doc-1", documentSha256: SHA, parserVersion: "1.0.0", status: "FAILED", failureCode: "OCR_TIMEOUT", version: 2, attemptCount: 1, ocrCallCount: null, processingToken: null, processingExpiresAt: null, lastSucceededAt: null };
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
    expect(row!.ocrCallCount).toBe(1);
  });
});

describe("GEOGRAPHY — the vendor's reported inference geography", () => {
  it("a confirmed geography is stored with the result and audited (configured + observed)", async () => {
    await run();
    expect(row).toMatchObject({ status: "NEEDS_REVIEW", ocrInferenceGeo: "us" });
    const event = auditMock.mock.calls[0]![0] as { newValue: Record<string, unknown> };
    expect(event.newValue).toMatchObject({ inferenceGeo: "us", observedInferenceGeo: "us" });
  });

  it("OCR_GEO_MISMATCH from the reader → FAILED, NOTHING of the answer stored, audited with the configured geography and no observed one", async () => {
    read.mockResolvedValue({ ok: false, code: "OCR_GEO_MISMATCH" });
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_GEO_MISMATCH" });
    expect(row).toMatchObject({ status: "FAILED", failureCode: "OCR_GEO_MISMATCH", fields: null, ocrInferenceGeo: null, extractedPlateNumber: null, processingToken: null });
    const event = auditMock.mock.calls[0]![0] as { newValue: Record<string, unknown> };
    expect(event.newValue).toMatchObject({ failureCode: "OCR_GEO_MISMATCH", inferenceGeo: "us", observedInferenceGeo: null, aiAssisted: true });
    expect(read).toHaveBeenCalledTimes(1); // no second attempt on another geography
  });
});

describe("the OCR result", () => {
  it("is stored as source OCR with the engine, validated fields and typed identifiers — always NEEDS_REVIEW, lease cleared", async () => {
    await run();
    expect(row).toMatchObject({
      status: "NEEDS_REVIEW",
      source: "OCR",
      ocrEngine: ENGINE,
      documentSha256: SHA,
      failureCode: null,
      extractedPlateNumber: "T 99001",
      extractedVin: "TESTV1N0000000001",
      extractedManufactureYear: 2020,
      extractedLicensedPassengerCapacity: 7,
      licenseExpiryDate: "2027-05-31",
      processingToken: null,
      processingExpiresAt: null,
    });
    const fields = row!.fields as Record<string, { confidence: string }>;
    expect(Object.values(fields).some((f) => f.confidence === "HIGH")).toBe(false);
    expect(row!.lastSucceededAt).toBeInstanceOf(Date);
  });

  it("is audited ONCE, in the completing transaction, as an AI-assisted SUGGESTION — metadata only, no values", async () => {
    await run();
    expect(auditMock).toHaveBeenCalledTimes(1);
    const event = auditMock.mock.calls[0]![0] as { action: string; actorType: string; newValue: Record<string, unknown> };
    expect(event).toMatchObject({ action: "vehicle.registration_extracted", actorType: "SYSTEM" });
    expect(event.newValue).toMatchObject({ status: "NEEDS_REVIEW", source: "OCR", aiAssisted: true, ocrEngine: ENGINE, reason: "REGISTRATION_DOCUMENT_READING", confidence: "SUGGESTION_REQUIRES_PROVIDER_REVIEW", fieldsRead: 7, fieldsNeedingReview: 7 });
    const raw = JSON.stringify(event);
    for (const value of ["T 99001", "TESTV1N0000000001", "Toyota", "Testcruiser", "asset-documents/", SHA]) expect(raw).not.toContain(value);
  });

  it("nothing readable in the document → FAILED / OCR_UNREADABLE (retryable, manual entry open)", async () => {
    read.mockResolvedValue({ ok: true, candidates: {} });
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_UNREADABLE" });
    expect(row).toMatchObject({ status: "FAILED", fields: null });
  });

  it.each(["OCR_TIMEOUT", "OCR_PROVIDER_ERROR", "OCR_MALFORMED_RESPONSE"] as const)("a reader failure (%s) is recorded as a retryable FAILED outcome — never a partial result", async (code) => {
    read.mockResolvedValue({ ok: false, code });
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: code });
    expect(row).toMatchObject({ status: "FAILED", failureCode: code, fields: null, processingToken: null });
    expect(row!.lastSucceededAt).toBeNull();
  });

  it("a reader that THROWS (contract breach) is treated as a provider error — no stuck row, no leaked message", async () => {
    read.mockRejectedValue(new Error("boom with T 99001 and a key"));
    expect(await run()).toMatchObject({ ok: true, status: "FAILED", failureCode: "OCR_PROVIDER_ERROR" });
    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("one effective OCR call per document", () => {
  it("RETRY / RELOAD / REPLAY after a result exists → answered from the stored result; the engine is NOT called again", async () => {
    await run();
    expect(read).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: true });
    expect(read).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("a request arriving while one is IN FLIGHT does no work and reports PROCESSING", async () => {
    row = { id: "ext-1", assetDocumentId: "doc-1", documentSha256: SHA, parserVersion: "1.0.0", status: "PROCESSING", failureCode: null, version: 3, attemptCount: 1, processingToken: "someone-else", processingExpiresAt: new Date(Date.now() + 60_000) };
    expect(await run()).toEqual({ ok: true, extractionId: "ext-1", status: "PROCESSING", failureCode: null, idempotent: true });
    expect(read).not.toHaveBeenCalled();
    expect(ext.updateMany).not.toHaveBeenCalled();
  });

  it("TIMEOUT then retry → exactly one more call; the row moves FAILED → PROCESSING → NEEDS_REVIEW", async () => {
    read.mockResolvedValueOnce({ ok: false, code: "OCR_TIMEOUT" });
    expect(await run()).toMatchObject({ status: "FAILED", failureCode: "OCR_TIMEOUT" });
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    expect(read).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ status: "NEEDS_REVIEW", attemptCount: 2 });
  });

  it("an attempt that DIED (expired lease) is taken over by the next request", async () => {
    row = { id: "ext-1", assetDocumentId: "doc-1", documentSha256: SHA, parserVersion: "1.0.0", status: "PROCESSING", failureCode: null, version: 3, attemptCount: 1, processingToken: "dead-attempt", processingExpiresAt: new Date(Date.now() - 1_000), lastSucceededAt: null };
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    expect(read).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: "NEEDS_REVIEW", attemptCount: 2, processingToken: null });
  });

  it("losing the claim to a concurrent request → no call", async () => {
    ext.create.mockImplementationOnce(async () => {
      // another request created and claimed the row first
      row = { id: "ext-1", assetDocumentId: "doc-1", documentSha256: SHA, parserVersion: "1.0.0", status: "PROCESSING", failureCode: null, version: 0, attemptCount: 1, processingToken: "winner", processingExpiresAt: new Date(Date.now() + 60_000) };
      throw P2002();
    });
    expect(await run()).toMatchObject({ ok: true, status: "PROCESSING", idempotent: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("IDENTICAL bytes already read for the SAME provider by the same engine → reused, no call", async () => {
    const fields = Object.fromEntries(
      ["plateNumber", "plateType", "makeDescription", "model", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"].map((k) => [
        k,
        k === "makeDescription" ? { rawValue: "Toyota", normalizedValue: "Toyota", confidence: "MEDIUM", warnings: [] } : { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] },
      ]),
    );
    reuseHit = { status: "NEEDS_REVIEW", fields, warnings: [], extractedVin: null, extractedPlateNumber: null, extractedLicensedPassengerCapacity: null, extractedManufactureYear: null, licenseExpiryDate: null };
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW", idempotent: false });
    expect(read).not.toHaveBeenCalled();
    expect(row).toMatchObject({ source: "OCR", ocrEngine: ENGINE, status: "NEEDS_REVIEW" });
    expect(row!.warnings).toContain("REUSED_IDENTICAL_DOCUMENT");
    // The lookup is scoped to THIS provider, this engine, these bytes — and never the same document.
    const where = ext.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ documentSha256: SHA, source: "OCR", ocrEngine: ENGINE, assetDocumentId: { not: "doc-1" }, asset: { providerId: "prov-1" } });
  });

  it("a stored blob that does not match the strict allowlisted shape is never copied — the engine is called instead", async () => {
    reuseHit = { status: "NEEDS_REVIEW", fields: { ownerName: "Synthetic Person" }, warnings: [] };
    await run();
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(row)).not.toContain("Synthetic Person");
  });
});

describe("late answers and failures never mark an extraction complete", () => {
  it("the setup was CANCELLED while OCR was running (row deleted) → the late answer is DISCARDED: nothing written, nothing audited", async () => {
    read.mockImplementation(async () => {
      row = null; // deleteDraftVehicle removed the extraction with the document
      return GOOD;
    });
    expect(await run()).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(row).toBeNull(); // not resurrected
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("the document was deleted BEFORE the claim (foreign-key violation) → the engine is never called", async () => {
    createError = P2003();
    expect(await run()).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(read).not.toHaveBeenCalled();
  });

  it("the lease was TAKEN OVER while this attempt was reading → its answer is discarded; the newer attempt's row is untouched", async () => {
    read.mockImplementation(async () => {
      row = { ...row!, processingToken: "newer-attempt", version: Number(row!.version) + 1 }; // someone else now holds it
      return GOOD;
    });
    expect(await run()).toMatchObject({ ok: true, status: "PROCESSING", idempotent: true });
    expect(row).toMatchObject({ status: "PROCESSING", processingToken: "newer-attempt", fields: null });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("AUDIT FAILURE → not complete: the row is handed back as a retryable FAILED (no fields), and the caller gets a safe code", async () => {
    auditMock.mockRejectedValueOnce(new Error("audit boom"));
    // The in-memory transaction does not roll back, so emulate the rollback of the completing update.
    ext.updateMany.mockImplementationOnce(async ({ where, data }: { where: Row; data: Row }) => {
      if (!matches(where)) return { count: 0 };
      void data; // rolled back with the failed audit
      return { count: 1 };
    });
    expect(await run()).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(row).toMatchObject({ status: "FAILED", failureCode: "EXTRACTION_FAILED", processingToken: null, fields: null });
    expect(row!.lastSucceededAt).toBeNull();
    // …and a retry reads it again.
    expect(await run()).toMatchObject({ ok: true, status: "NEEDS_REVIEW" });
  });

  it("nothing sensitive is logged on any failure path — a category only", async () => {
    auditMock.mockRejectedValueOnce(new Error(`failed for T 99001 at asset-documents/x with sha ${SHA}`));
    await run();
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [event, fields] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("registrationExtraction.ocr_complete_failed");
    expect(Object.keys(fields).sort()).toEqual(["assetDocumentId", "error"]);
    expect(JSON.stringify(loggerError.mock.calls)).not.toMatch(/T 99001|asset-documents\/x|Toyota/);
  });
});
