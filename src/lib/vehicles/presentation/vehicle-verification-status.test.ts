import { describe, it, expect } from "vitest";
import {
  getVehicleVerificationBadgeVariant,
  getVehicleVerificationTranslationKey,
  getVehicleDocStatusBadgeVariant,
  getVehicleDocStatusTranslationKey,
} from "./vehicle-verification-status";

describe("vehicle verification-status presentation", () => {
  it("maps each verification status to a badge variant + key", () => {
    expect(getVehicleVerificationTranslationKey("SUBMITTED")).toBe("vehicleVerifyStatusSubmitted");
    expect(getVehicleVerificationTranslationKey("CHANGES_REQUESTED")).toBe("vehicleVerifyStatusChangesRequested");
    expect(getVehicleVerificationBadgeVariant("APPROVED")).toBe("success");
    expect(getVehicleVerificationBadgeVariant("REJECTED")).toBe("danger");
    expect(getVehicleVerificationBadgeVariant("DRAFT")).toBe("default");
  });

  it("falls back to DRAFT for an unknown verification status", () => {
    // @ts-expect-error deliberately invalid runtime value
    expect(getVehicleVerificationTranslationKey("BOGUS")).toBe("vehicleVerifyStatusDraft");
  });

  it("maps document statuses, and null → 'not uploaded'", () => {
    expect(getVehicleDocStatusTranslationKey("PENDING")).toBe("vehicleDocStatusPending");
    expect(getVehicleDocStatusTranslationKey("APPROVED")).toBe("vehicleDocStatusApproved");
    expect(getVehicleDocStatusTranslationKey("REJECTED")).toBe("vehicleDocStatusRejected");
    expect(getVehicleDocStatusTranslationKey(null)).toBe("vehicleDocStatusMissing");
    expect(getVehicleDocStatusBadgeVariant("REJECTED")).toBe("danger");
    expect(getVehicleDocStatusBadgeVariant("APPROVED")).toBe("success");
  });
});
