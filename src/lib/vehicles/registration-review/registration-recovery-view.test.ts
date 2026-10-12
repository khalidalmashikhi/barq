import { describe, it, expect, vi, beforeEach } from "vitest";
import { REGISTRATION_PARSER_VERSION as CURRENT_VERSION, MAX_OCR_CALLS_PER_DOCUMENT } from "@/lib/vehicles/registration-extraction/constants";

// Review read model — the RECOVERY state (2026-10-09): derived on the server from the stored
// semantic version and the stored result, never from the client, never by writing on a GET.

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const assetFindFirst = vi.fn();
// The read model may ONLY read — any write method on the client would be a bug.
const writeSpy = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) },
    vehicleRegistrationExtraction: { update: writeSpy, updateMany: writeSpy, create: writeSpy, upsert: writeSpy },
    vehicleRegistrationConfirmation: { update: writeSpy, updateMany: writeSpy, create: writeSpy },
    $transaction: writeSpy,
  },
}));
const policyMock = vi.fn<() => { processor: string; purpose: string; policyVersion: string; inferenceGeo: "us" | "global" } | null>(() => null);
vi.mock("@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader", () => ({ getRegistrationOcrPolicy: () => policyMock() }));

const { getRegistrationReview } = await import("./get-registration-review");

const VEHICLE = "11111111-1111-1111-1111-111111111111";
const POLICY = { processor: "anthropic", purpose: "VEHICLE_REGISTRATION_READING", policyVersion: "2026-10-09-v2", inferenceGeo: "us" as const };
const KEYS = ["plateNumber", "plateType", "makeDescription", "model", "vehicleDescription", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "registeredSeats", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"];
const missing = () => ({ rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] });
function stored(over: Record<string, unknown> = {}) {
  const f: Record<string, unknown> = Object.fromEntries(KEYS.map((k) => [k, missing()]));
  f.vehicleDescription = { rawValue: "صالون مازدا6", normalizedValue: "صالون مازدا6", confidence: "HIGH", warnings: [] };
  f.manufactureYear = { rawValue: "2019", normalizedValue: 2019, confidence: "HIGH", warnings: [] };
  f.color = { rawValue: "أبيض", normalizedValue: "أبيض", confidence: "HIGH", warnings: [] };
  return { ...f, ...over };
}
const MAKE = { rawValue: "x", normalizedValue: "Mazda", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };
const MODEL = { rawValue: "x", normalizedValue: "6", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };

function setup(extraction: Record<string, unknown>, opts: { mime?: string; confirmations?: unknown[]; consents?: unknown[] } = {}) {
  assetFindFirst.mockResolvedValue({
    id: VEHICLE,
    documents: [
      {
        id: "doc-1",
        type: "VEHICLE_REGISTRATION",
        status: "PENDING",
        originalFilename: "reg.pdf",
        mimeType: opts.mime ?? "application/pdf",
        sizeBytes: 1000,
        registrationExtraction: {
          id: "ext-1", status: "NEEDS_REVIEW", failureCode: null, documentSha256: "sha-1", parserVersion: CURRENT_VERSION, source: "NATIVE_PDF_TEXT",
          processingExpiresAt: null, fields: stored(), lastAttemptedAt: new Date(), lastSucceededAt: new Date(), warnings: [], ocrCallCount: null,
          ...extraction,
        },
        registrationConfirmations: opts.confirmations ?? [],
        registrationOcrConsents: opts.consents ?? [],
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApprovedProviderMock.mockResolvedValue({ barqUser: { id: "user-1" }, provider: { id: "prov-1" } });
  policyMock.mockReturnValue(POLICY);
});

describe("recovery state — server-derived from the stored version and result", () => {
  it("3. a reading stored under an OLDER semantic version is exposed as STALE (with the staging shape: description + Sedan hint, no make/model)", async () => {
    setup({ parserVersion: "1.1.0" });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.recovery.state).toBe("STALE");
    expect(r.recovery.completionAvailable).toBe(false); // never completed externally on old rules
    expect(r.vehicleTypeSuggestion).toBe("SEDAN");
    expect(r.documentDescription).toBe("صالون مازدا6");
    expect(r.fields.find((f) => f.key === "make")!.extractedValue).toBeNull();
  });

  it("15. CURRENT but missing make/model → INCOMPLETE, and the optional completion is offered for a native-text PDF when configured", async () => {
    setup({});
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.recovery).toEqual({ state: "INCOMPLETE", completionAvailable: true, completionInProgress: false, completionApplied: false, completionFailed: false });
  });

  it("CURRENT and complete (make + model present) → no banner at all", async () => {
    setup({ fields: stored({ makeDescription: MAKE, model: MODEL }) });
    const r = (await getRegistrationReview(VEHICLE))!;
    expect(r.recovery.state).toBeNull();
    expect(r.recovery.completionAvailable).toBe(false);
  });

  it("the completion is NOT offered when automatic reading is not configured, for photos, for an automatic reading, at the call ceiling, once applied, or while one is running", async () => {
    policyMock.mockReturnValue(null);
    setup({});
    expect((await getRegistrationReview(VEHICLE))!.recovery).toMatchObject({ state: "INCOMPLETE", completionAvailable: false });
    policyMock.mockReturnValue(POLICY);
    setup({}, { mime: "image/jpeg" });
    expect((await getRegistrationReview(VEHICLE))!.recovery.completionAvailable).toBe(false);
    setup({ source: "OCR" });
    expect((await getRegistrationReview(VEHICLE))!.recovery.completionAvailable).toBe(false);
    setup({ ocrCallCount: MAX_OCR_CALLS_PER_DOCUMENT });
    expect((await getRegistrationReview(VEHICLE))!.recovery.completionAvailable).toBe(false);
    setup({ warnings: ["AUTOMATIC_COMPLETION_APPLIED"] });
    expect((await getRegistrationReview(VEHICLE))!.recovery).toMatchObject({ completionApplied: true, completionAvailable: false });
    setup({ processingExpiresAt: new Date(Date.now() + 60_000) });
    expect((await getRegistrationReview(VEHICLE))!.recovery).toMatchObject({ completionInProgress: true, completionAvailable: false });
  });

  it("a failed completion is reported (local reading kept) and may be tried again", async () => {
    setup({ warnings: ["AUTOMATIC_COMPLETION_FAILED"] });
    expect((await getRegistrationReview(VEHICLE))!.recovery).toMatchObject({ state: "INCOMPLETE", completionFailed: true, completionAvailable: true });
  });

  it("a locked (SUBMITTED) review shows no recovery banner", async () => {
    setup({}, { confirmations: [{ status: "SUBMITTED", submittedAt: new Date(), boundDocumentSha256: "sha-1", boundParserVersion: CURRENT_VERSION }] });
    expect((await getRegistrationReview(VEHICLE))!.recovery.state).toBeNull();
  });

  it("rendering the review never writes (no re-read, no rebind on a GET)", async () => {
    setup({ parserVersion: "1.1.0" });
    await getRegistrationReview(VEHICLE);
    await getRegistrationReview(VEHICLE);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("the read model never selects the lease token, the storage key, the checksum-bearing engine id or raw text for the view", async () => {
    setup({});
    await getRegistrationReview(VEHICLE);
    const select = JSON.stringify(assetFindFirst.mock.calls[0]![0].select);
    expect(select).not.toMatch(/processingToken|objectKey|ocrEngine/);
  });
});

describe("fields after an automatic completion", () => {
  it("a completed field is flagged 'completed automatically' and needs review; an explicit field that differed is flagged for review", async () => {
    setup({
      warnings: ["AUTOMATIC_COMPLETION_APPLIED"],
      fields: stored({
        makeDescription: { rawValue: "Mazda", normalizedValue: "Mazda", confidence: "MEDIUM", warnings: ["FROM_AUTOMATIC_COMPLETION"] },
        model: { rawValue: "6", normalizedValue: "6", confidence: "MEDIUM", warnings: ["FROM_AUTOMATIC_COMPLETION"] },
        color: { rawValue: "أبيض", normalizedValue: "أبيض", confidence: "HIGH", warnings: ["AUTOMATIC_READING_DIFFERS"] },
      }),
    });
    const r = (await getRegistrationReview(VEHICLE))!;
    const make = r.fields.find((f) => f.key === "make")!;
    expect(make).toMatchObject({ extractedValue: "Mazda", completedAutomatically: true, needsReview: true, source: "NATIVE_PDF_TEXT" });
    expect(r.fields.find((f) => f.key === "color")!).toMatchObject({ extractedValue: "أبيض", needsReview: true });
    expect(r.recovery.state).toBeNull(); // now complete
  });

  it("31. the provider's own DRAFT entries are never overwritten by a completion: their value stays the starting value", async () => {
    setup(
      {
        warnings: ["AUTOMATIC_COMPLETION_APPLIED"],
        fields: stored({ makeDescription: { rawValue: "Mazda", normalizedValue: "Mazda", confidence: "MEDIUM", warnings: ["FROM_AUTOMATIC_COMPLETION"] }, model: { rawValue: "6", normalizedValue: "6", confidence: "MEDIUM", warnings: ["FROM_AUTOMATIC_COMPLETION"] } }),
      },
      { confirmations: [{ status: "DRAFT", submittedAt: null, boundDocumentSha256: "sha-1", boundParserVersion: CURRENT_VERSION, make: "Mazda", model: "CX-30 Testtrim", modelYear: 2019, color: null, bookablePassengerCapacity: null, licensedPassengerCapacity: null, registeredSeats: null, plateNumber: null, plateType: null, vin: null, engineNumber: null, usageClassification: null, engineCapacity: null, emptyWeight: null, maximumLoad: null, axleCount: null, licenseValidFrom: null, licenseExpiry: null, firstRegistrationDate: null }] },
    );
    const r = (await getRegistrationReview(VEHICLE))!;
    const model = r.fields.find((f) => f.key === "model")!;
    expect(model.confirmedValue).toBe("CX-30 Testtrim");
    expect(model.source).toBe("PROVIDER");
  });
});
