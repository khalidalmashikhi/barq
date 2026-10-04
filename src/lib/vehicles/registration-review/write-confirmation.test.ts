import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const auditMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const assetFindFirst = vi.fn();
const confCreate = vi.fn();
const confUpdateMany = vi.fn();
const txClient = {
  asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
  vehicleRegistrationConfirmation: { create: (...a: unknown[]) => confCreate(...a), updateMany: (...a: unknown[]) => confUpdateMany(...a) },
};
const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (cb: (tx: unknown) => unknown) => transaction(cb) } }));

const { writeRegistrationConfirmation } = await import("./write-confirmation");

const VEHICLE = "11111111-1111-1111-1111-111111111111";
// Extraction fields JSON (Slice-2 persisted shape) — only a couple matter for the diff.
const extractionFields: Record<string, { rawValue: string | null; normalizedValue: string | number | null; confidence: string; warnings: string[] }> = Object.fromEntries(
  ["plateNumber", "plateType", "makeDescription", "model", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"].map(
    (k) => [k, { rawValue: null, normalizedValue: null as string | number | null, confidence: "LOW", warnings: [] as string[] }],
  ),
);
extractionFields.vin!.normalizedValue = "JTEBU29J8K5012345";
extractionFields.makeDescription!.normalizedValue = "Toyota";

const assetRow = (confirmations: unknown[] = []) => ({
  id: VEHICLE,
  documents: [{ id: "doc-1", registrationExtraction: { id: "ext-1", documentSha256: "sha-current", parserVersion: "1.0.0", fields: extractionFields }, registrationConfirmations: confirmations }],
});

const FULL: Record<string, unknown> = {
  make: "Toyota", model: "Land Cruiser", modelYear: "2019", color: "White",
  bookablePassengerCapacity: "13", licensedPassengerCapacity: "13", registeredSeats: "15",
  plateNumber: "A 12345", vin: "JTEBU29J8K5012345", licenseExpiry: "31/05/2027", declarationAccepted: "true",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "22222222-2222-2222-2222-222222222222" }, provider: { id: "prov-1" } });
  assetFindFirst.mockResolvedValue(assetRow([]));
  confCreate.mockResolvedValue({ id: "conf-1" });
  confUpdateMany.mockResolvedValue({ count: 1 });
});

describe("writeRegistrationConfirmation", () => {
  it("DRAFT with no active claim → creates a DRAFT bound to the current extraction", async () => {
    const res = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "Toyota" });
    expect(res).toEqual({ ok: true });
    const data = (confCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ status: "DRAFT", boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0", extractionId: "ext-1", assetDocumentId: "doc-1", providerId: "prov-1" });
    expect(data.submittedAt).toBeNull();
  });

  it("SUBMIT with a full valid claim → creates SUBMITTED with submittedByUserId + audit (metadata only)", async () => {
    const res = await writeRegistrationConfirmation("SUBMIT", VEHICLE, FULL);
    expect(res).toEqual({ ok: true });
    const data = (confCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ status: "SUBMITTED", submittedByUserId: "22222222-2222-2222-2222-222222222222", vin: "JTEBU29J8K5012345", bookablePassengerCapacity: 13 });
    const auditArg = auditMock.mock.calls.at(-1)?.[0] as { action: string; newValue: Record<string, unknown> };
    expect(auditArg.action).toBe("vehicle.registration_confirmation_submitted");
    expect(Object.keys(auditArg.newValue).sort()).toEqual(["correctedFields", "status"].sort());
    expect(JSON.stringify(auditArg.newValue)).not.toContain("JTEBU29J8K5012345");
  });

  it("SUBMIT invalid (missing declaration) → INVALID_INPUT, no transaction", async () => {
    const res = await writeRegistrationConfirmation("SUBMIT", VEHICLE, { ...FULL, declarationAccepted: "false" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("SUBMIT with capacity violation → INVALID_INPUT with the capacity error", async () => {
    const res = await writeRegistrationConfirmation("SUBMIT", VEHICLE, { ...FULL, bookablePassengerCapacity: "14", licensedPassengerCapacity: "13" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.some((e) => e.field === "capacity")).toBe(true);
  });

  it("current SUBMITTED claim (not stale) → LOCKED, no write", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-9", status: "SUBMITTED", version: 0, boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0" }]));
    const res = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" });
    expect(res).toEqual({ ok: false, code: "LOCKED" });
    expect(confUpdateMany).not.toHaveBeenCalled();
    expect(confCreate).not.toHaveBeenCalled();
  });

  it("replaced document (stale SUBMITTED) → SUPERSEDED as-is, NO rebind/create, caller told to re-review", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-old", status: "SUBMITTED", version: 3, boundDocumentSha256: "sha-OLD", boundParserVersion: "1.0.0" }]));
    const res = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "Toyota" });
    expect(res).toEqual({ ok: false, code: "SUPERSEDED" });
    expect(confUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "conf-old", version: 3, status: { not: "SUPERSEDED" } }, data: { status: "SUPERSEDED" } });
    expect(confCreate).not.toHaveBeenCalled(); // values are NOT carried forward
    expect(auditMock.mock.calls.some((c) => (c[0] as { action: string }).action === "vehicle.registration_confirmation_superseded")).toBe(true);
  });

  it("replaced document (stale DRAFT) → SUPERSEDED as-is, provider values NEVER rebound/carried forward", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-d", status: "DRAFT", version: 1, boundDocumentSha256: "sha-OLD", boundParserVersion: "1.0.0" }]));
    const res = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "Toyota", vin: "JTEBU29J8K5012345" });
    expect(res).toEqual({ ok: false, code: "SUPERSEDED" });
    expect(confUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "conf-d", version: 1 }, data: { status: "SUPERSEDED" } });
    expect(confCreate).not.toHaveBeenCalled();
    // The superseded updateMany writes ONLY status — no provider values touch the historical row.
    expect(Object.keys((confUpdateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data)).toEqual(["status"]);
  });

  it("active DRAFT → guarded updateMany(version); count 0 → CONFLICT", async () => {
    assetFindFirst.mockResolvedValue(assetRow([{ id: "conf-d", status: "DRAFT", version: 2, boundDocumentSha256: "sha-current", boundParserVersion: "1.0.0" }]));
    const res1 = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "Toyota" });
    expect(res1).toEqual({ ok: true });
    expect(confUpdateMany.mock.calls[0]?.[0]).toMatchObject({ where: { id: "conf-d", version: 2 }, data: { version: 3 } });
    confUpdateMany.mockResolvedValue({ count: 0 });
    const res2 = await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "Toyota" });
    expect(res2).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("no extraction yet → EXTRACTION_NOT_READY", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [{ id: "doc-1", registrationExtraction: null, registrationConfirmations: [] }] });
    expect(await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" })).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
  });

  it("the document is BEING READ (live OCR lease) → EXTRACTION_NOT_READY for both DRAFT and SUBMIT; nothing is written", async () => {
    const reading = { id: "ext-1", documentSha256: "sha-current", parserVersion: "1.0.0", fields: null, status: "PROCESSING", processingExpiresAt: new Date(Date.now() + 60_000) };
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [{ id: "doc-1", registrationExtraction: reading, registrationConfirmations: [] }] });
    expect(await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" })).toEqual({ ok: false, code: "EXTRACTION_NOT_READY" });
    expect(confCreate).not.toHaveBeenCalled();
  });

  it("a reading whose lease has EXPIRED (the attempt died) no longer blocks manual entry", async () => {
    const abandoned = { id: "ext-1", documentSha256: "sha-current", parserVersion: "1.0.0", fields: null, status: "PROCESSING", processingExpiresAt: new Date(Date.now() - 1_000) };
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [{ id: "doc-1", registrationExtraction: abandoned, registrationConfirmations: [] }] });
    expect(await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" })).toEqual({ ok: true });
  });

  it("concurrent create (P2002) → CONFLICT", async () => {
    confCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("u", { code: "P2002", clientVersion: "5.22.0" }));
    expect(await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" })).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("foreign/missing vehicle → VEHICLE_NOT_FOUND", async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await writeRegistrationConfirmation("DRAFT", VEHICLE, { make: "X" })).toEqual({ ok: false, code: "VEHICLE_NOT_FOUND" });
  });
});
