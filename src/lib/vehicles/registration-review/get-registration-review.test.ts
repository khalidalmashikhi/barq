import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const assetFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) } } }));
// Automatic reading availability + the notice consent is bound to (environment). Off by default.
const policyMock = vi.fn<() => { processor: string; purpose: string; policyVersion: string; inferenceGeo: "us" | "global" } | null>(() => null);
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => ({ getRegistrationOcrPolicy: () => policyMock() }));

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
        id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", originalFilename: "reg.pdf", mimeType: "application/pdf", sizeBytes: 1000,
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
        id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", originalFilename: "reg.pdf", mimeType: "application/pdf", sizeBytes: 1000,
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
    documents: [{ id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", originalFilename: "photo.jpg", mimeType, sizeBytes: 2000, registrationExtraction: { id: "ext-1", failureCode: null, documentSha256: "sha-1", parserVersion: "1.0.0", processingExpiresAt: null, lastAttemptedAt: new Date(), lastSucceededAt: new Date(), ...extraction }, registrationConfirmations: confirmations }],
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

describe("getRegistrationReview — the OCR consent view", () => {
  const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-v1", inferenceGeo: "us" as const };
  const photoDoc = (consents: unknown[], over: Record<string, unknown> = {}) => ({
    id: VEHICLE,
    documents: [{
      id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", originalFilename: "IMG.jpg", mimeType: "image/jpeg", sizeBytes: 3000,
      registrationExtraction: { id: "ext-1", status: "FAILED", failureCode: "OCR_CONSENT_REQUIRED", documentSha256: "sha-1", parserVersion: "1.0.0", source: "OCR", processingExpiresAt: null, fields: null, lastAttemptedAt: new Date(), lastSucceededAt: null, ...over },
      registrationConfirmations: [],
      registrationOcrConsents: consents,
    }],
  });
  const grantedRow = (policyVersion: string, documentSha256 = "sha-1") => ({ decision: "GRANTED", policyVersion, processor: "anthropic", documentSha256, createdAt: new Date() });

  it("automatic reading NOT available → ocrConsent is null and the row reads as plain 'unavailable' (manual entry)", async () => {
    policyMock.mockReturnValue(null);
    assetFindFirst.mockResolvedValue(photoDoc([]));
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.ocrConsent).toBeNull();
    expect(r?.reviewState).toMatchObject({ extraction: "FAILED", failureLabelKey: "vehicleRegExtractFailOcrUnavailable", canConfirm: true });
  });

  it("available + no decision → AWAITING_CONSENT with state NONE; the notice facts shown carry no key or model", async () => {
    policyMock.mockReturnValue(POLICY);
    assetFindFirst.mockResolvedValue(photoDoc([]));
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.reviewState.extraction).toBe("AWAITING_CONSENT");
    expect(r?.ocrConsent).toEqual({ state: "NONE", policyVersion: "2026-10-v1", processor: "anthropic", inferenceGeo: "us" });
    expect(JSON.stringify(r)).not.toMatch(/claude|sonnet|apiKey|sk-ant/i);
    // The consent lookup is scoped to the signed-in provider and takes only the latest row.
    const select = assetFindFirst.mock.calls[0]![0].select.documents.select.registrationOcrConsents;
    expect(select).toMatchObject({ where: { providerId: "prov-1" }, take: 1 });
  });

  it("DECLINED → state DECLINED (manual entry, compact notice)", async () => {
    policyMock.mockReturnValue(POLICY);
    assetFindFirst.mockResolvedValue(photoDoc([{ decision: "DECLINED", policyVersion: "2026-10-v1", processor: "anthropic", documentSha256: null, createdAt: new Date() }]));
    expect((await getRegistrationReview(VEHICLE))?.ocrConsent?.state).toBe("DECLINED");
  });

  it("GRANTED for an older notice → STALE (asked again); GRANTED for the current one → GRANTED", async () => {
    policyMock.mockReturnValue(POLICY);
    assetFindFirst.mockResolvedValue(photoDoc([grantedRow("2026-09-v0")]));
    expect((await getRegistrationReview(VEHICLE))?.ocrConsent?.state).toBe("STALE");
    assetFindFirst.mockResolvedValue(photoDoc([grantedRow("2026-10-v1")], { status: "NEEDS_REVIEW", failureCode: null, fields }));
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.ocrConsent?.state).toBe("GRANTED");
    expect(r?.reviewState.extraction).toBe("NEEDS_REVIEW");
  });

  it("GRANTED for the bytes BEFORE a replacement → NONE for the new bytes (asked again, the step shows)", async () => {
    policyMock.mockReturnValue(POLICY);
    assetFindFirst.mockResolvedValue(photoDoc([grantedRow("2026-10-v1", "sha-OLD")], { documentSha256: "sha-NEW" }));
    const r = await getRegistrationReview(VEHICLE);
    expect(r?.ocrConsent?.state).toBe("NONE");
    expect(r?.reviewState.extraction).toBe("AWAITING_CONSENT");
  });
});

describe("getRegistrationReview — the registration document SET", () => {
  const page = (id: string, type: string, filename: string, sizeBytes: number, extra: Record<string, unknown> = {}) => ({ id, type, status: "PENDING", originalFilename: filename, mimeType: "image/jpeg", sizeBytes, registrationExtraction: null, registrationConfirmations: [], registrationOcrConsents: [], ...extra });
  const ocrExtraction = (over: Record<string, unknown> = {}) => ({ id: "ext-1", status: "NEEDS_REVIEW", failureCode: null, documentSha256: "set-sha", parserVersion: "1.0.0", source: "OCR", processingExpiresAt: null, fields, lastAttemptedAt: new Date(), lastSucceededAt: new Date(), ...over });

  it("lists every side in ORDER (front first) whatever order the database returned them, with a safe page view — never a storage key", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-back", "VEHICLE_REGISTRATION_BACK", "back.jpg", 2000, { objectKey: "asset-documents/x/back.jpg" }), page("doc-front", "VEHICLE_REGISTRATION", "front.jpg", 1000, { registrationExtraction: ocrExtraction() })] });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.documentId).toBe("doc-front");
    expect(r.setKind).toBe("IMAGES");
    expect(r.pages.map((p) => p.role)).toEqual(["FRONT", "BACK"]);
    expect(r.pages.map((p) => p.documentId)).toEqual(["doc-front", "doc-back"]);
    for (const p of r.pages) expect(Object.keys(p).sort()).toEqual(["documentId", "filename", "mimeType", "role", "sizeBytes"]);
    expect(JSON.stringify(r)).not.toContain("asset-documents");
    expect(r.reviewState.extraction).toBe("NEEDS_REVIEW");
  });

  it("a lone BACK row (no front) is not a set: no document, no pages", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-back", "VEHICLE_REGISTRATION_BACK", "back.jpg", 2000)] });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.documentId).toBeNull();
    expect(r.pages).toEqual([]);
    expect(r.setKind).toBeNull();
  });

  it("set kinds: one PDF → PDF; one photo → IMAGE; two photos → IMAGES", async () => {
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [{ ...page("doc-1", "VEHICLE_REGISTRATION", "reg.pdf", 500), mimeType: "application/pdf" }] });
    expect((await getRegistrationReview(VEHICLE))!.setKind).toBe("PDF");
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", "front.jpg", 500)] });
    expect((await getRegistrationReview(VEHICLE))!.setKind).toBe("IMAGE");
  });

  it("a CONFLICT field arrives UNRESOLVED with its alternatives and flagged — nothing chosen; other fields carry no alternatives", async () => {
    const conflictFields = JSON.parse(JSON.stringify(fields)) as typeof fields & Record<string, { alternatives?: unknown[] }>;
    conflictFields.manufactureYear = { rawValue: "2019", normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives: [2019, 2020] } as never;
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-front", "VEHICLE_REGISTRATION", "front.jpg", 1000, { registrationExtraction: ocrExtraction({ fields: conflictFields }) }), page("doc-back", "VEHICLE_REGISTRATION_BACK", "back.jpg", 2000)] });
    const r = (await getRegistrationReview(VEHICLE))!;
    const year = r.fields.find((f) => f.key === "modelYear")!;
    expect(year).toMatchObject({ extractedValue: null, conflict: true, alternatives: [2019, 2020], needsReview: true, source: "UNRESOLVED" });
    const make = r.fields.find((f) => f.key === "make")!;
    expect(make).toMatchObject({ extractedValue: "Toyota", conflict: false, alternatives: [] });
  });
});

describe("getRegistrationReview — Oman field-mapping correction", () => {
  const page = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, status: "PENDING", originalFilename: "f.jpg", mimeType: "image/jpeg", sizeBytes: 1000, registrationExtraction: null, registrationConfirmations: [], registrationOcrConsents: [], ...extra });
  const withFields = (over: Record<string, unknown>, status = "NEEDS_REVIEW") => {
    const f = JSON.parse(JSON.stringify(fields)) as Record<string, unknown>;
    Object.assign(f, over);
    return { id: "ext-1", status, failureCode: null, documentSha256: "sha-1", parserVersion: "1.1.0", source: "NATIVE_PDF_TEXT", processingExpiresAt: null, fields: f, lastAttemptedAt: new Date(), lastSucceededAt: new Date() };
  };

  it("a make/model DERIVED from the compound description arrives flagged (heuristic + needsReview) and the description itself is exposed privately", async () => {
    const extraction = withFields({
      vehicleDescription: { rawValue: "Toyota Station Modelname", normalizedValue: "Toyota Station Modelname", confidence: "HIGH", warnings: [] },
      makeDescription: { rawValue: "Toyota Station Modelname", normalizedValue: "Toyota", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] },
      model: { rawValue: "Toyota Station Modelname", normalizedValue: "Modelname", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] },
    });
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: extraction })] });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.documentDescription).toBe("Toyota Station Modelname");
    expect(r.fields.find((f) => f.key === "make")).toMatchObject({ extractedValue: "Toyota", heuristic: true, needsReview: true, source: "NATIVE_PDF_TEXT" });
    expect(r.fields.find((f) => f.key === "model")).toMatchObject({ extractedValue: "Modelname", heuristic: true, needsReview: true });
    expect(r.fields.find((f) => f.key === "modelYear")).toMatchObject({ heuristic: false });
  });

  it("the vehicle TYPE is only ever a SUGGESTION on the view (from the description / make / model / usage) — there is no chosen type and no type field", async () => {
    const extraction = withFields({ vehicleDescription: { rawValue: "Toyota Pickup 4x4 Modelname", normalizedValue: "Toyota Pickup 4x4 Modelname", confidence: "HIGH", warnings: [] } });
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: extraction })] });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.vehicleTypeSuggestion).toBe("FOUR_BY_FOUR");
    expect(r.fields.map((f) => f.key)).not.toContain("vehicleType");
    expect("vehicleType" in r).toBe(false);
    // With nothing recognizable the suggestion is null — never OTHER, never a default.
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: withFields({}) })] });
    expect((await getRegistrationReview(VEHICLE))!.vehicleTypeSuggestion).toBeNull();
  });

  it("registered seats are suggested ONLY when the document printed a seats value; otherwise unresolved and NOT flagged as required", async () => {
    const printed = withFields({ registeredSeats: { rawValue: "8", normalizedValue: 8, confidence: "HIGH", warnings: [] }, licensedPassengerCapacity: { rawValue: "7", normalizedValue: 7, confidence: "HIGH", warnings: [] } });
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: printed })] });
    let r = (await getRegistrationReview(VEHICLE))!;
    expect(r.fields.find((f) => f.key === "registeredSeats")).toMatchObject({ extractedValue: 8, required: false });
    expect(r.fields.find((f) => f.key === "licensedPassengerCapacity")).toMatchObject({ extractedValue: 7 });
    const notPrinted = withFields({ licensedPassengerCapacity: { rawValue: "7", normalizedValue: 7, confidence: "HIGH", warnings: [] } });
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: notPrinted })] });
    r = (await getRegistrationReview(VEHICLE))!;
    expect(r.fields.find((f) => f.key === "registeredSeats")).toMatchObject({ extractedValue: null, required: false, needsReview: false, source: "UNRESOLVED" });
    expect(r.fields.find((f) => f.key === "bookablePassengerCapacity")).toMatchObject({ extractedValue: null, required: true, source: "UNRESOLVED", needsReview: true }); // always the provider's own entry
  });

  it("a record written by parser 1.0.0 (no description / seats keys) still reads: those simply have no suggestion", async () => {
    const legacy = withFields({});
    delete (legacy.fields as Record<string, unknown>).vehicleDescription;
    delete (legacy.fields as Record<string, unknown>).registeredSeats;
    legacy.parserVersion = "1.0.0";
    assetFindFirst.mockResolvedValue({ id: VEHICLE, documents: [page("doc-1", "VEHICLE_REGISTRATION", { registrationExtraction: legacy })] });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.documentDescription).toBeNull();
    expect(r.fields.find((f) => f.key === "vin")?.extractedValue).toBe("JTEBU29J8K5012345"); // the old suggestions are intact
    expect(r.fields.find((f) => f.key === "registeredSeats")?.extractedValue).toBeNull();
  });
});
