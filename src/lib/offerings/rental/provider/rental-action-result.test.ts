import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rentalActionMessageKey, rentalErrorField, type RentalActionCode } from "./rental-action-result";

const ALL_CODES: RentalActionCode[] = [
  "UNAUTHENTICATED", "PROVIDER_NOT_APPROVED", "NO_PROVIDER_PROFILE", "SERVICE_NOT_FOUND", "VEHICLE_NOT_FOUND",
  "OFFERING_NOT_FOUND", "WRONG_SERVICE_KIND", "VERTICAL_NOT_AUTHORIZED", "VERTICAL_NOT_COMPLIANT",
  "VEHICLE_NOT_SELECTABLE", "VERIFIED_CAPACITY_MISSING", "INVALID_MONEY", "INVALID_CURRENCY", "CURRENCY_LOCKED",
  "CURRENCY_OVERRIDES_PRESENT", "INVALID_CAPACITY_OVERRIDE", "OFFERING_ALREADY_ACTIVE", "OFFERING_STATE_CONFLICT",
  "OFFERING_ARCHIVED", "NO_PUBLISHABLE_DAY", "INVALID_DATE", "DATE_WINDOW_TOO_LARGE", "OFFERING_DAY_NOT_FOUND",
  "INVALID_START_TIME", "INVALID_INPUT", "UNKNOWN_ERROR",
];

describe("rental-action-result mapping", () => {
  it("maps every action code to a key that actually exists in en/provider.json", () => {
    const en = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "en", "provider.json"), "utf8"));
    for (const code of ALL_CODES) {
      const key = rentalActionMessageKey(code);
      expect(typeof key).toBe("string");
      expect(en[key], `${code} → ${key} exists`).toBeTypeOf("string");
    }
  });

  it("collapses the three non-enumerating not-found codes to one generic message", () => {
    const k = rentalActionMessageKey("SERVICE_NOT_FOUND");
    expect(rentalActionMessageKey("VEHICLE_NOT_FOUND")).toBe(k);
    expect(rentalActionMessageKey("OFFERING_NOT_FOUND")).toBe(k);
    expect(k).toBe("rentalErrorResourceUnavailable");
  });

  it("attaches validation codes to the right form field, else null", () => {
    expect(rentalErrorField("INVALID_MONEY")).toBe("baseDailyAmount");
    expect(rentalErrorField("INVALID_CURRENCY")).toBe("currency");
    expect(rentalErrorField("CURRENCY_LOCKED")).toBe("currency");
    expect(rentalErrorField("CURRENCY_OVERRIDES_PRESENT")).toBe("currency");
    expect(rentalErrorField("INVALID_CAPACITY_OVERRIDE")).toBe("offeringCapacityOverride");
    expect(rentalErrorField("WRONG_SERVICE_KIND")).toBe("service");
    expect(rentalErrorField("VEHICLE_NOT_FOUND")).toBe("vehicle");
    // Lifecycle/compliance codes are NOT field errors (they belong in the lifecycle panel).
    expect(rentalErrorField("NO_PUBLISHABLE_DAY")).toBeNull();
    expect(rentalErrorField("OFFERING_STATE_CONFLICT")).toBeNull();
    expect(rentalErrorField("UNKNOWN_ERROR")).toBeNull();
  });
});
