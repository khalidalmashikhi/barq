import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const assetFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) } } }));

const { getRegistrationReview } = await import("./get-registration-review");

const VEHICLE = "11111111-1111-1111-1111-111111111111";
const fields: Record<string, { rawValue: string | null; normalizedValue: string | number | null; confidence: string; warnings: string[] }> = Object.fromEntries(
  ["plateNumber", "plateType", "makeDescription", "model", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"].map(
    (k) => [k, { rawValue: null, normalizedValue: null as string | number | null, confidence: "LOW", warnings: [] as string[] }],
  ),
);
fields.vin!.normalizedValue = "JTEBU29J8K5012345";
fields.vin!.confidence = "HIGH";
fields.makeDescription!.normalizedValue = "Toyota";

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
});

describe("getRegistrationReview", () => {
  it("invalid id → null (no query)", async () => {
    expect(await getRegistrationReview("bad")).toBeNull();
    expect(assetFindFirst).not.toHaveBeenCalled();
  });

  it("foreign/missing vehicle → null (owner-scoped, non-enumerating)", async () => {
    assetFindFirst.mockResolvedValue(null);
    expect(await getRegistrationReview(VEHICLE)).toBeNull();
    expect(assetFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({ id: VEHICLE, providerId: "prov-1", assetType: "VEHICLE" });
  });

  it("no registration document → NOT_ANALYZED, documentId null", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [] });
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.documentId).toBeNull();
    expect(r?.reviewState.extraction).toBe("NOT_ANALYZED");
  });

  it("with extraction + DRAFT confirmation → maps extracted suggestion, confirmed value, and decision", async () => {
    assetFindFirst.mockResolvedValue({
      id: VEHICLE,
      documents: [{
        id: "doc-1", status: "PENDING", originalFilename: "reg.pdf",
        registrationExtraction: { id: "ext-1", status: "EXTRACTED", failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", fields, lastAttemptedAt: new Date(), lastSucceededAt: new Date() },
        registrationConfirmations: [{ status: "DRAFT", submittedAt: null, boundDocumentSha256: "sha-1", boundParserVersion: "1.0.0", vin: "JTEBU29J8K5012345", make: "Honda", model: null, modelYear: null, color: null, bookablePassengerCapacity: 13, licensedPassengerCapacity: null, registeredSeats: null, plateNumber: null, plateType: null, engineNumber: null, usageClassification: null, engineCapacity: null, emptyWeight: null, maximumLoad: null, axleCount: null, licenseValidFrom: null, licenseExpiry: null, firstRegistrationDate: null }],
      }],
    });
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.reviewState.extraction).toBe("EXTRACTED");
    expect(r?.reviewState.confirmation).toBe("DRAFT");
    const vin = r?.fields.find((f) => f.key === "vin");
    expect(vin).toMatchObject({ extractedValue: "JTEBU29J8K5012345", confirmedValue: "JTEBU29J8K5012345", confidence: "HIGH", sensitive: true });
    expect(vin?.decision).toEqual({ matches: true, source: "EXTRACTED" });
    const make = r?.fields.find((f) => f.key === "make");
    expect(make?.decision).toEqual({ matches: false, source: "PROVIDER" }); // confirmed Honda vs extracted Toyota
    const bookable = r?.fields.find((f) => f.key === "bookablePassengerCapacity");
    expect(bookable?.decision).toEqual({ matches: false, source: "MANUAL" }); // no extraction suggestion
  });

  it("a STALE confirmation (document replaced) → reviewState STALE and its stale values are NOT shown as current", async () => {
    assetFindFirst.mockResolvedValue({
      id: VEHICLE,
      documents: [{
        id: "doc-1", status: "PENDING", originalFilename: "reg.pdf",
        registrationExtraction: { id: "ext-2", status: "EXTRACTED", failureCode: null, documentSha256: "sha-NEW", parserVersion: "1.0.0", fields, lastAttemptedAt: new Date(), lastSucceededAt: new Date() },
        registrationConfirmations: [{ status: "DRAFT", submittedAt: null, boundDocumentSha256: "sha-OLD", boundParserVersion: "1.0.0", vin: "OLDVALUE123456789", make: "StaleMake", model: null, modelYear: null, color: null, bookablePassengerCapacity: 99, licensedPassengerCapacity: null, registeredSeats: null, plateNumber: null, plateType: null, engineNumber: null, usageClassification: null, engineCapacity: null, emptyWeight: null, maximumLoad: null, axleCount: null, licenseValidFrom: null, licenseExpiry: null, firstRegistrationDate: null }],
      }],
    });
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.reviewState.confirmation).toBe("STALE");
    // The stale provider values must NOT surface; VIN prefills from the NEW extraction suggestion.
    const vin = r?.fields.find((f) => f.key === "vin");
    expect(vin?.confirmedValue).toBeNull();
    expect(vin?.extractedValue).toBe("JTEBU29J8K5012345");
    const make = r?.fields.find((f) => f.key === "make");
    expect(make?.confirmedValue).toBeNull(); // not "StaleMake"
  });
});

describe("getRegistrationReview — per-field source and 'needs review'", () => {
  const blank = { vin: null, make: null, model: null, modelYear: null, color: null, bookablePassengerCapacity: null, licensedPassengerCapacity: null, registeredSeats: null, plateNumber: null, plateType: null, engineNumber: null, usageClassification: null, engineCapacity: null, emptyWeight: null, maximumLoad: null, axleCount: null, licenseValidFrom: null, licenseExpiry: null, firstRegistrationDate: null };
  const ocrFields = JSON.parse(JSON.stringify(fields)) as typeof fields;
  ocrFields.makeDescription = { rawValue: "Toyota", normalizedValue: "Toyota", confidence: "MEDIUM", warnings: [] };
  ocrFields.model = { rawValue: "Prad0", normalizedValue: "Prad0", confidence: "LOW", warnings: ["OCR_UNCLEAR"] };
  ocrFields.manufactureYear = { rawValue: "2019", normalizedValue: 2019, confidence: "LOW", warnings: ["CONFLICT"] };
  ocrFields.vin = { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] };
  const doc = (extraction: Record<string, unknown>, confirmations: unknown[] = [], mimeType = "image/jpeg") => ({
    id: VEHICLE,
    documents: [{ id: "doc-1", status: "PENDING", originalFilename: "photo.jpg", mimeType, registrationExtraction: { id: "ext-1", failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", processingExpiresAt: null, lastAttemptedAt: new Date(), lastSucceededAt: new Date(), ...extraction }, registrationConfirmations: confirmations }],
  });
  const field = (r: Awaited<ReturnType<typeof getRegistrationReview>>, key: string) => r!.fields.find((f) => f.key === key)!;

  it("an OCR result: every read value is sourced OCR and flagged; a missing REQUIRED field is UNRESOLVED and flagged; an optional missing one is not", async () => {
    assetFindFirst.mockResolvedValue(doc({ status: "NEEDS_REVIEW", source: "OCR", fields: ocrFields }));
    const r = await getRegistrationReview(VEHICLE);
    expect(r).toMatchObject({ extractionSource: "OCR", documentMimeType: "image/jpeg" });
    expect(field(r, "make")).toMatchObject({ source: "OCR", needsReview: true, confidence: "MEDIUM" });
    expect(field(r, "model")).toMatchObject({ source: "OCR", needsReview: true, confidence: "LOW" });
    expect(field(r, "modelYear")).toMatchObject({ source: "OCR", needsReview: true });
    expect(field(r, "vin")).toMatchObject({ source: "UNRESOLVED", needsReview: true, extractedValue: null }); // required
    expect(field(r, "engineNumber")).toMatchObject({ source: "UNRESOLVED", needsReview: false }); // optional
    // Never suggested from any document: the provider decides capacity and seats.
    expect(field(r, "bookablePassengerCapacity")).toMatchObject({ source: "UNRESOLVED", extractedValue: null, needsReview: true });
    expect(field(r, "registeredSeats")).toMatchObject({ source: "UNRESOLVED", extractedValue: null });
  });

  it("a NATIVE-TEXT result: a HIGH-confidence value is from the document and NOT flagged; a lower one is", async () => {
    assetFindFirst.mockResolvedValue(doc({ status: "EXTRACTED", source: "NATIVE_PDF_TEXT", fields }, [], "application/pdf"));
    const r = await getRegistrationReview(VEHICLE);
    expect(r).toMatchObject({ extractionSource: "NATIVE_PDF_TEXT", documentMimeType: "application/pdf" });
    expect(field(r, "vin")).toMatchObject({ source: "NATIVE_PDF_TEXT", needsReview: false, confidence: "HIGH" });
    expect(field(r, "make")).toMatchObject({ source: "NATIVE_PDF_TEXT", needsReview: true, confidence: "LOW" });
  });

  it("a value the provider CORRECTED or ENTERED is theirs — sourced PROVIDER and no longer flagged; one they left as read stays document-sourced", async () => {
    assetFindFirst.mockResolvedValue(
      doc({ status: "NEEDS_REVIEW", source: "OCR", fields: ocrFields }, [{ ...blank, status: "DRAFT", submittedAt: null, boundDocumentSha256: "sha-1", boundParserVersion: "1.0.0", make: "Toyota", model: "Prado", vin: "TESTV1N0000000001" }]),
    );
    const r = await getRegistrationReview(VEHICLE);
    expect(field(r, "model")).toMatchObject({ source: "PROVIDER", needsReview: false, confirmedValue: "Prado", extractedValue: "Prad0" }); // corrected
    expect(field(r, "vin")).toMatchObject({ source: "PROVIDER", needsReview: false, confirmedValue: "TESTV1N0000000001" }); // entered (nothing was read)
    expect(field(r, "make")).toMatchObject({ source: "OCR", confirmedValue: "Toyota" }); // kept as read → still an OCR value
  });

  it("no usable reading (FAILED / being read) → no source is claimed for any field", async () => {
    assetFindFirst.mockResolvedValue(doc({ status: "FAILED", failureCode: "OCR_TIMEOUT", source: "OCR", fields: null }));
    const failed = await getRegistrationReview(VEHICLE);
    expect(failed!.extractionSource).toBeNull();
    expect(failed!.fields.every((f) => f.source === "UNRESOLVED" && f.extractedValue === null)).toBe(true);

    assetFindFirst.mockResolvedValue(doc({ status: "PROCESSING", source: "OCR", fields: null, processingExpiresAt: new Date(Date.now() + 60_000) }));
    const reading = await getRegistrationReview(VEHICLE);
    expect(reading!.reviewState).toMatchObject({ extraction: "PROCESSING", canConfirm: false, canAnalyze: false });
    expect(reading!.extractionSource).toBeNull();
  });

  it("the view never carries the storage key, the document checksum, the OCR engine id or any raw text", async () => {
    assetFindFirst.mockResolvedValue(doc({ status: "NEEDS_REVIEW", source: "OCR", ocrEngine: "claude-vision/x/p1", fields: ocrFields }));
    const raw = JSON.stringify(await getRegistrationReview(VEHICLE));
    for (const needle of ["sha-1", "objectKey", "asset-documents", "claude-vision", "ocrEngine", "rawValue", "processingToken"]) expect(raw).not.toContain(needle);
    const select = JSON.stringify(assetFindFirst.mock.calls.at(-1)![0].select);
    expect(select).not.toMatch(/objectKey|processingToken|ocrEngine/);
  });
});
