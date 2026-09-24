import { describe, it, expect } from "vitest";
import {
  getRentalOfferingStatusBadgeVariant,
  getRentalOfferingStatusTranslationKey,
  isRentalReadinessBlocker,
  getRentalBlockerTranslationKey,
} from "./rental-offering-status";

describe("rental-offering-status presentation", () => {
  it("maps each lifecycle status to a badge variant and a translation key", () => {
    expect(getRentalOfferingStatusBadgeVariant("DRAFT")).toBe("info");
    expect(getRentalOfferingStatusBadgeVariant("PUBLISHED")).toBe("success");
    expect(getRentalOfferingStatusBadgeVariant("SUSPENDED")).toBe("warning");
    expect(getRentalOfferingStatusBadgeVariant("ARCHIVED")).toBe("default");

    expect(getRentalOfferingStatusTranslationKey("DRAFT")).toBe("rentalOfferingStatusDraft");
    expect(getRentalOfferingStatusTranslationKey("PUBLISHED")).toBe("rentalOfferingStatusPublished");
    expect(getRentalOfferingStatusTranslationKey("SUSPENDED")).toBe("rentalOfferingStatusSuspended");
    expect(getRentalOfferingStatusTranslationKey("ARCHIVED")).toBe("rentalOfferingStatusArchived");
  });

  it("recognizes only the provider-actionable readiness blockers, and maps them to keys", () => {
    for (const code of [
      "VERTICAL_NOT_AUTHORIZED",
      "VERTICAL_NOT_COMPLIANT",
      "VEHICLE_NOT_SELECTABLE",
      "VERIFIED_CAPACITY_MISSING",
      "PROVIDER_NOT_APPROVED",
      "NO_PROVIDER_PROFILE",
      "NO_PUBLISHABLE_DAY",
    ] as const) {
      expect(isRentalReadinessBlocker(code)).toBe(true);
    }
    // Internal / non-readiness codes must NOT be surfaced as a readiness warning.
    for (const code of ["INVALID_MONEY", "OFFERING_STATE_CONFLICT", "UNKNOWN_ERROR", "INVALID_DATE"] as const) {
      expect(isRentalReadinessBlocker(code)).toBe(false);
    }

    expect(getRentalBlockerTranslationKey("VEHICLE_NOT_SELECTABLE")).toBe("rentalBlockerVehicleNotSelectable");
    expect(getRentalBlockerTranslationKey("VERIFIED_CAPACITY_MISSING")).toBe("rentalBlockerCapacityMissing");
    expect(getRentalBlockerTranslationKey("NO_PUBLISHABLE_DAY")).toBe("rentalBlockerNoOpenDay");
    // Both provider-status codes collapse to one message key (no enumeration of which).
    expect(getRentalBlockerTranslationKey("PROVIDER_NOT_APPROVED")).toBe("rentalBlockerProviderNotApproved");
    expect(getRentalBlockerTranslationKey("NO_PROVIDER_PROFILE")).toBe("rentalBlockerProviderNotApproved");
  });
});
