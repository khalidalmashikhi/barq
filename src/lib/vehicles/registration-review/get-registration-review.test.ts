import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));
const assetFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { asset: { findFirst: (...a: unknown[]) => assetFindFirst(...a) } } }));

const { getRegistrationReview } = await import("./get-registration-review");

const VEHICLE = "11111111-1111-1111-1111-111111111111";
const fields = Object.fromEntries(
  ["plateNumber", "plateType", "makeDescription", "model", "color", "usageClassification", "manufactureYear", "engineCapacity", "emptyWeight", "maximumLoad", "axleCount", "licensedPassengerCapacity", "vin", "engineNumber", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate"].map(
    (k) => [k, { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: [] }],
  ),
);
fields.vin.normalizedValue = "JTEBU29J8K5012345";
fields.vin.confidence = "HIGH";
fields.makeDescription.normalizedValue = "Toyota";

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
});
