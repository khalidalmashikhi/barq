import { describe, it, expect } from "vitest";
import { toPublicVehicle, toProviderVehicle, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";
import { toProviderVehicleApiDTO } from "@/lib/api/v1/vehicle-dtos";
import { REGISTRATION_EXTRACTION_FAILURE_CODES } from "./codes";

// Phase 3C Slice 2 — public no-leak proof. The private extraction model/fields are wired
// into NO customer or provider vehicle DTO in this slice; these tests pin that so a future
// change can't silently surface an extracted identifier, a document hash, or raw metadata.

const EXTRACTION_KEYS = [
  "extractedVin", "extractedPlateNumber", "extractedLicensedPassengerCapacity", "extractedManufactureYear",
  "licenseExpiryDate", "documentSha256", "parserVersion", "fields", "warnings", "failureCode", "rawValue", "confidence",
  // Slice-2 correction (H): the broader private/extraction surface must also never reach a public DTO.
  "vin", "engineNumber", "licenseValidFrom", "firstRegistrationDate", "assetDocumentId", "extractionId",
  "attemptCount", "lastAttemptedAt", "lastSucceededAt", "processedAt", "source", "normalizedValue",
];

const row = {
  assetId: "asset-1", make: "Toyota", model: "Land Cruiser", modelYear: 2025, color: "White", vehicleType: "FOUR_BY_FOUR",
  bookablePassengerCapacity: 6, registeredSeats: 14, licensedPassengerCapacity: 15, publicDescription: null,
  registrationNumber: "OM 12345", claimedFourByFour: null, fourByFourVerified: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
  asset: { status: "ACTIVE", providerId: "prov-1" },
} as unknown as VehicleWithAsset;

describe("registration-extraction — public no-leak", () => {
  it("PublicVehicleDTO carries NO extraction identifiers/metadata", () => {
    const dto = toPublicVehicle(row) as Record<string, unknown>;
    for (const k of EXTRACTION_KEYS) expect(dto[k]).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("Sha256");
  });

  it("the provider domain + api-v1 vehicle DTOs also carry NO extraction metadata", () => {
    const provider = toProviderVehicle(row) as Record<string, unknown>;
    const api = toProviderVehicleApiDTO(toProviderVehicle(row)) as Record<string, unknown>;
    for (const k of EXTRACTION_KEYS) {
      expect(provider[k]).toBeUndefined();
      expect(api[k]).toBeUndefined();
    }
  });

  it("failure codes are opaque constant strings (never carry an extracted value)", () => {
    for (const code of REGISTRATION_EXTRACTION_FAILURE_CODES) {
      expect(/^[A-Z_]+$/.test(code)).toBe(true);
    }
  });
});
