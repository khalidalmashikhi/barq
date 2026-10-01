import { describe, it, expect } from "vitest";
import { toPublicVehicle, toProviderVehicle, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";
import { toProviderVehicleApiDTO } from "@/lib/api/v1/vehicle-dtos";
import { CUSTOMER_FIELD_KEYS, SENSITIVE_FIELD_KEYS } from "./field-model";

// Phase 3C Slice 3A — public no-leak proof. The provider confirmation CLAIM and its sensitive
// identifiers are a PRIVATE provider surface wired into NO customer/public vehicle DTO.

const CONFIRMATION_PRIVATE_KEYS = [
  "vin", "plateNumber", "plateType", "engineNumber", "usageClassification", "engineCapacity", "emptyWeight",
  "maximumLoad", "axleCount", "licenseValidFrom", "licenseExpiry", "firstRegistrationDate", "registeredSeats",
  "licensedPassengerCapacity", "boundDocumentSha256", "boundParserVersion", "submittedByUserId", "fieldDecisions",
  "declarationAccepted", "extractedValue", "confirmedValue", "confirmation", "decision",
];

const row = {
  assetId: "asset-1", make: "Toyota", model: "Land Cruiser", modelYear: 2025, color: "White", vehicleType: "FOUR_BY_FOUR",
  bookablePassengerCapacity: 6, registeredSeats: 14, licensedPassengerCapacity: 15, publicDescription: null,
  registrationNumber: "OM 12345", claimedFourByFour: null, fourByFourVerified: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
  asset: { status: "ACTIVE", providerId: "prov-1" },
} as unknown as VehicleWithAsset;

describe("registration-review — public no-leak", () => {
  it("PublicVehicleDTO carries none of the confirmation/private fields (only bookable passengerCapacity)", () => {
    const dto = toPublicVehicle(row) as Record<string, unknown>;
    for (const k of CONFIRMATION_PRIVATE_KEYS) expect(dto[k]).toBeUndefined();
    expect(dto.passengerCapacity).toBe(6); // the only capacity a customer sees
  });

  it("the provider domain + api-v1 vehicle DTOs also carry no confirmation claim fields", () => {
    const provider = toProviderVehicle(row) as Record<string, unknown>;
    const api = toProviderVehicleApiDTO(toProviderVehicle(row)) as Record<string, unknown>;
    for (const k of ["boundDocumentSha256", "submittedByUserId", "fieldDecisions", "declarationAccepted", "confirmation", "decision", "vin", "engineNumber", "plateNumber"]) {
      expect(provider[k]).toBeUndefined();
      expect(api[k]).toBeUndefined();
    }
  });

  it("sensitive identifiers (VIN/plate/engine) are NOT in the customer-relevant field group", () => {
    for (const k of SENSITIVE_FIELD_KEYS) expect(CUSTOMER_FIELD_KEYS).not.toContain(k);
  });
});
