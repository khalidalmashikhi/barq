import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
// The default deps reference the global prisma + storage, but every test passes explicit deps.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/storage/storage", () => ({ isDocumentStorageConfigured: () => true, downloadPrivateObject: async () => new ArrayBuffer(0) }));

const { runVehicleRegistrationExtraction } = await import("./extract-registration-service");

const REG_TEXT = ["رقم اللوحة: A 12345", "نوع المركبة: Toyota", "الموديل: Land Cruiser", "عدد الركاب: 7", "سنة الصنع: 2019", "رقم الهيكل: JTEBU29J8K5012345", "تاريخ الانتهاء: 31/05/2027"].join("\n");
const BYTES = new TextEncoder().encode("fake-pdf-bytes").buffer;
const SHA = createHash("sha256").update(Buffer.from(BYTES)).digest("hex");
const VERSION = "1.0.0";
const goodDoc = { id: "doc-1", type: "VEHICLE_REGISTRATION", objectKey: "asset-documents/asset-1/reg/x.pdf", mimeType: "application/pdf", assetId: "asset-1", asset: { assetType: "VEHICLE", providerId: "prov-1" } };

// Mocks shared across tests.
const assetDocFindUnique = vi.fn();
const extFindUnique = vi.fn();
const extCreate = vi.fn();
const extUpdateMany = vi.fn();
const txClient = { vehicleRegistrationExtraction: { create: (...a: unknown[]) => extCreate(...a), updateMany: (...a: unknown[]) => extUpdateMany(...a) } };
const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
const db = {
  assetDocument: { findUnique: (...a: unknown[]) => assetDocFindUnique(...a) },
  vehicleRegistrationExtraction: { findUnique: (...a: unknown[]) => extFindUnique(...a) },
  $transaction: (cb: (tx: unknown) => unknown) => transaction(cb),
} as never;

const extractOk = vi.fn(async () => ({ ok: true as const, pageCount: 1, text: REG_TEXT }));
const download = vi.fn(async () => BYTES);
// Native-text path: no OCR engine is involved (the OCR tier has its own suite, ocr-extraction.test.ts).
const deps = () => ({ db, extractPdfText: extractOk, downloadPrivateObject: download, isStorageConfigured: () => true, getReader: () => null });

const P2002 = new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5.22.0" });

beforeEach(() => {
  vi.clearAllMocks();
  assetDocFindUnique.mockResolvedValue(goodDoc);
  extFindUnique.mockResolvedValue(null);
  extCreate.mockResolvedValue({ id: "ext-1", status: "EXTRACTED", failureCode: null });
  extUpdateMany.mockResolvedValue({ count: 1 });
  extractOk.mockResolvedValue({ ok: true, pageCount: 1, text: REG_TEXT });
  download.mockResolvedValue(BYTES);
});

describe("guards", () => {
  it("DOCUMENT_NOT_FOUND / WRONG_DOCUMENT_TYPE / NOT_A_VEHICLE / STORAGE_NOT_CONFIGURED / DOWNLOAD_FAILED", async () => {
    assetDocFindUnique.mockResolvedValueOnce(null);
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, deps())).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    assetDocFindUnique.mockResolvedValueOnce({ ...goodDoc, type: "VEHICLE_INSURANCE" });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, deps())).toEqual({ ok: false, error: "WRONG_DOCUMENT_TYPE" });
    assetDocFindUnique.mockResolvedValueOnce({ ...goodDoc, asset: { assetType: "OTHER" } });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, deps())).toEqual({ ok: false, error: "NOT_A_VEHICLE" });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, { ...deps(), isStorageConfigured: () => false })).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, { ...deps(), downloadPrivateObject: vi.fn(async () => { throw new Error("gone"); }) })).toEqual({ ok: false, error: "DOWNLOAD_FAILED" });
  });
});

describe("state machine", () => {
  it("no existing row → create EXTRACTED with attemptCount 1 + lastSucceededAt, audited, never touches Vehicle", async () => {
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ ok: true, extractionId: "ext-1", status: "EXTRACTED", idempotent: false });
    const data = (extCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ assetId: "asset-1", documentSha256: SHA, parserVersion: VERSION, status: "EXTRACTED", attemptCount: 1, extractedVin: "JTEBU29J8K5012345", extractedLicensedPassengerCapacity: 7 });
    expect(data.lastSucceededAt).toBeInstanceOf(Date);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(txClient)).toEqual(["vehicleRegistrationExtraction"]); // no Vehicle writer on the tx client
  });

  it("existing EXTRACTED + same hash & version → idempotent no-op (no parse, no write, no audit)", async () => {
    extFindUnique.mockResolvedValue({ id: "ext-9", documentSha256: SHA, parserVersion: VERSION, status: "EXTRACTED", failureCode: null });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toEqual({ ok: true, extractionId: "ext-9", status: "EXTRACTED", failureCode: null, idempotent: true });
    expect(extractOk).not.toHaveBeenCalled();
    expect(extCreate).not.toHaveBeenCalled();
    expect(extUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("existing NEEDS_REVIEW + same → idempotent no-op", async () => {
    extFindUnique.mockResolvedValue({ id: "ext-9", documentSha256: SHA, parserVersion: VERSION, status: "NEEDS_REVIEW", failureCode: null });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ idempotent: true, status: "NEEDS_REVIEW" });
    expect(extractOk).not.toHaveBeenCalled();
  });

  it("existing FAILED + same → RETRYABLE: re-parses and guard-updates with attemptCount++", async () => {
    extFindUnique.mockResolvedValue({ id: "ext-9", documentSha256: SHA, parserVersion: VERSION, status: "FAILED", failureCode: "PARSER_TIMEOUT", version: 2, attemptCount: 2, lastSucceededAt: null });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ ok: true, status: "EXTRACTED", idempotent: false });
    expect(extractOk).toHaveBeenCalledTimes(1);
    const upd = (extUpdateMany.mock.calls[0]?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> });
    expect(upd.where).toEqual({ id: "ext-9", version: 2 });
    expect(upd.data).toMatchObject({ status: "EXTRACTED", attemptCount: 3, version: 3 });
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("parser version changed → reprocess even if the stored row was EXTRACTED", async () => {
    extFindUnique.mockResolvedValue({ id: "ext-9", documentSha256: SHA, parserVersion: "0.9.0", status: "EXTRACTED", failureCode: null, version: 0, attemptCount: 1, lastSucceededAt: new Date() });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ idempotent: false });
    expect(extractOk).toHaveBeenCalled();
    expect(extUpdateMany).toHaveBeenCalled();
  });

  it("document hash changed → reprocess (replaced document)", async () => {
    extFindUnique.mockResolvedValue({ id: "ext-9", documentSha256: "different", parserVersion: VERSION, status: "EXTRACTED", failureCode: null, version: 0, attemptCount: 1, lastSucceededAt: new Date() });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ idempotent: false });
    expect(extUpdateMany).toHaveBeenCalled();
  });
});

describe("concurrency safety", () => {
  it("a concurrent create (P2002) is caught and resolved by re-reading the winner — no raw error, no second audit", async () => {
    // pre-check: none; persist attempt 1: none → create throws P2002; attempt 2: winner present.
    extFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "win", documentSha256: SHA, parserVersion: VERSION, status: "EXTRACTED", failureCode: null, version: 0, attemptCount: 1, lastSucceededAt: new Date() });
    extCreate.mockRejectedValueOnce(P2002);
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    expect(res).toMatchObject({ ok: true, extractionId: "win", status: "EXTRACTED", idempotent: true });
    expect(auditMock).not.toHaveBeenCalled(); // our create rolled back; winner audited in its own process
    expect(extUpdateMany).not.toHaveBeenCalled();
  });

  it("a transient FAILURE never overwrites a concurrent SUCCESS of the same hash+version", async () => {
    // pre-check sees nothing; our extraction FAILS; persist finds a concurrent EXTRACTED → no downgrade.
    extFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "win", documentSha256: SHA, parserVersion: VERSION, status: "EXTRACTED", failureCode: null, version: 0, attemptCount: 1, lastSucceededAt: new Date() });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, { ...deps(), extractPdfText: vi.fn(async () => ({ ok: false as const, code: "PARSER_TIMEOUT" as const })) });
    expect(res).toMatchObject({ ok: true, extractionId: "win", status: "EXTRACTED", idempotent: true });
    expect(extUpdateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a non-P2002 transaction failure → UNKNOWN_ERROR (nothing partial)", async () => {
    extCreate.mockRejectedValueOnce(new Error("db down"));
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps())).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });
});

describe("audit privacy", () => {
  it("audit metadata is SYSTEM + metadata only (no extracted values / PII / fields / object key)", async () => {
    await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, deps());
    const params = auditMock.mock.calls[0]?.[0] as { actorType: string; actorId: null; newValue: Record<string, unknown> };
    expect(params.actorType).toBe("SYSTEM");
    expect(params.actorId).toBeNull();
    expect(Object.keys(params.newValue).sort()).toEqual(["failureCode", "parserVersion", "source", "status"].sort());
    for (const forbidden of ["JTEBU29J8K5012345", "A 12345", "rawValue", "fields", "objectKey", "فلان"]) {
      expect(JSON.stringify(params.newValue)).not.toContain(forbidden);
    }
  });

  it("FAILED extraction persists status FAILED + safe code, null typed columns, lastSucceededAt null", async () => {
    extCreate.mockResolvedValueOnce({ id: "ext-2", status: "FAILED", failureCode: "PDF_ENCRYPTED" });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, { ...deps(), extractPdfText: vi.fn(async () => ({ ok: false as const, code: "PDF_ENCRYPTED" as const })) });
    expect(res).toMatchObject({ ok: true, status: "FAILED", failureCode: "PDF_ENCRYPTED", idempotent: false });
    const data = (extCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ status: "FAILED", failureCode: "PDF_ENCRYPTED", extractedVin: null, extractedPlateNumber: null, lastSucceededAt: null });
  });
});
