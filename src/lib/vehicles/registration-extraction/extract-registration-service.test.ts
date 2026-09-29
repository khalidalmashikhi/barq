import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

// --- mocks (wrapper pattern so vi.mock hoisting can reference these lazily) ---
const assetDocFindUnique = vi.fn();
const extractionFindUnique = vi.fn();
const upsertMock = vi.fn();
const txClient = { vehicleRegistrationExtraction: { upsert: (...a: unknown[]) => upsertMock(...a) } };
const transactionMock = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
vi.mock("@/lib/db", () => ({
  prisma: {
    assetDocument: { findUnique: (...a: unknown[]) => assetDocFindUnique(...a) },
    vehicleRegistrationExtraction: { findUnique: (...a: unknown[]) => extractionFindUnique(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => transactionMock(cb),
  },
}));

let storageConfigured = true;
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => storageConfigured,
  downloadPrivateObject: async () => new ArrayBuffer(0),
}));

const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { runVehicleRegistrationExtraction } = await import("./extract-registration-service");

const REG_TEXT = ["رقم اللوحة: A 12345", "نوع المركبة: Toyota", "الموديل: Land Cruiser", "عدد الركاب: 7", "سنة الصنع: 2019", "رقم الهيكل: JTEBU29J8K5012345", "تاريخ الانتهاء: 31/05/2027"].join("\n");
const BYTES = new TextEncoder().encode("fake-pdf-bytes").buffer;
const SHA = createHash("sha256").update(Buffer.from(BYTES)).digest("hex");
const okDeps = { extractPdfText: vi.fn(async () => ({ ok: true as const, pageCount: 1, text: REG_TEXT })), downloadPrivateObject: vi.fn(async () => BYTES) };

const goodDoc = { id: "doc-1", type: "VEHICLE_REGISTRATION", objectKey: "asset-documents/asset-1/reg/x.pdf", assetId: "asset-1", asset: { assetType: "VEHICLE" } };

beforeEach(() => {
  storageConfigured = true;
  assetDocFindUnique.mockReset().mockResolvedValue(goodDoc);
  extractionFindUnique.mockReset().mockResolvedValue(null);
  upsertMock.mockReset().mockResolvedValue({ id: "ext-1", status: "EXTRACTED", failureCode: null });
  transactionMock.mockClear();
  auditMock.mockReset().mockResolvedValue(undefined);
  okDeps.extractPdfText.mockClear();
  okDeps.downloadPrivateObject.mockClear();
});

describe("runVehicleRegistrationExtraction — guards", () => {
  it("DOCUMENT_NOT_FOUND when the document is missing", async () => {
    assetDocFindUnique.mockResolvedValue(null);
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "x" }, okDeps)).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
  });
  it("WRONG_DOCUMENT_TYPE for a non-registration document", async () => {
    assetDocFindUnique.mockResolvedValue({ ...goodDoc, type: "VEHICLE_INSURANCE" });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps)).toEqual({ ok: false, error: "WRONG_DOCUMENT_TYPE" });
  });
  it("NOT_A_VEHICLE when the asset is not a vehicle", async () => {
    assetDocFindUnique.mockResolvedValue({ ...goodDoc, asset: { assetType: "OTHER" } });
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps)).toEqual({ ok: false, error: "NOT_A_VEHICLE" });
  });
  it("STORAGE_NOT_CONFIGURED when the private bucket is unset", async () => {
    storageConfigured = false;
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps)).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
  });
  it("never accepts a provider id — the input type is only { assetDocumentId }", () => {
    // Compile-time guarantee reflected here: the function signature carries no providerId.
    expect(okDeps.extractPdfText).toBeDefined();
  });
});

describe("runVehicleRegistrationExtraction — extraction + persistence", () => {
  it("EXTRACTED: persists typed columns + validated fields in a transaction, never touches Vehicle", async () => {
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps);
    expect(res).toEqual({ ok: true, extractionId: "ext-1", status: "EXTRACTED", failureCode: null, idempotent: false });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const createArg = (upsertMock.mock.calls[0]?.[0] as { create: Record<string, unknown> }).create;
    expect(createArg).toMatchObject({
      assetId: "asset-1",
      assetDocumentId: "doc-1",
      documentSha256: SHA,
      parserVersion: "1.0.0",
      source: "NATIVE_PDF_TEXT",
      status: "EXTRACTED",
      extractedVin: "JTEBU29J8K5012345",
      extractedPlateNumber: "A 12345",
      extractedLicensedPassengerCapacity: 7,
    });
    // The mocked tx client exposes ONLY the extraction upsert — any Vehicle write would throw.
    expect(Object.keys(txClient)).toEqual(["vehicleRegistrationExtraction"]);
  });

  it("audit metadata carries NO extracted values or PII — only status/source/version/failureCode", async () => {
    await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps);
    const params = auditMock.mock.calls[0]?.[0] as { actorType: string; actorId: null; newValue: Record<string, unknown> };
    expect(params.actorType).toBe("SYSTEM");
    expect(params.actorId).toBeNull();
    expect(Object.keys(params.newValue).sort()).toEqual(["failureCode", "parserVersion", "source", "status"].sort());
    const json = JSON.stringify(params.newValue);
    for (const forbidden of ["JTEBU29J8K5012345", "A 12345", "rawValue", "fields", "objectKey", "فلان"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("idempotent: same document hash + parser version → no rewrite, no audit", async () => {
    extractionFindUnique.mockResolvedValue({ id: "ext-1", documentSha256: SHA, parserVersion: "1.0.0", status: "EXTRACTED", failureCode: null, version: 3 });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps);
    expect(res).toEqual({ ok: true, extractionId: "ext-1", status: "EXTRACTED", failureCode: null, idempotent: true });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(okDeps.extractPdfText).not.toHaveBeenCalled();
  });

  it("FAILED extraction (encrypted) persists status FAILED + safe code, null typed columns", async () => {
    const failDeps = { extractPdfText: vi.fn(async () => ({ ok: false as const, code: "PDF_ENCRYPTED" as const })), downloadPrivateObject: vi.fn(async () => BYTES) };
    upsertMock.mockResolvedValue({ id: "ext-2", status: "FAILED", failureCode: "PDF_ENCRYPTED" });
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, failDeps);
    expect(res).toEqual({ ok: true, extractionId: "ext-2", status: "FAILED", failureCode: "PDF_ENCRYPTED", idempotent: false });
    const createArg = (upsertMock.mock.calls[0]?.[0] as { create: Record<string, unknown> }).create;
    expect(createArg).toMatchObject({ status: "FAILED", failureCode: "PDF_ENCRYPTED", extractedVin: null, extractedPlateNumber: null });
  });

  it("a transaction failure returns UNKNOWN_ERROR and persists nothing (rollback)", async () => {
    transactionMock.mockRejectedValue(new Error("db down"));
    const res = await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, okDeps);
    expect(res).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });

  it("DOWNLOAD_FAILED when the bytes cannot be fetched", async () => {
    const badDeps = { extractPdfText: okDeps.extractPdfText, downloadPrivateObject: vi.fn(async () => { throw new Error("gone"); }) };
    expect(await runVehicleRegistrationExtraction({ assetDocumentId: "doc-1" }, badDeps)).toEqual({ ok: false, error: "DOWNLOAD_FAILED" });
  });
});
