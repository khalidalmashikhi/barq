import { describe, it, expect } from "vitest";
import { getVehicleSelectabilityBlockers, isVehicleSelectable, type VehicleSelectabilityInput } from "./selectability";

const NOW = new Date("2026-08-20T00:00:00.000Z");

// Base: fully selectable — ACTIVE + APPROVED, no document requirement.
const base: VehicleSelectabilityInput = {
  status: "ACTIVE",
  verificationStatus: "APPROVED",
  requiredDocumentTypes: [],
  documents: [],
  now: NOW,
};

describe("getVehicleSelectabilityBlockers — status × verification axis", () => {
  it("ACTIVE + APPROVED (no doc requirement) passes with zero blockers", () => {
    expect(getVehicleSelectabilityBlockers(base)).toEqual([]);
    expect(isVehicleSelectable(base)).toBe(true);
  });

  it("REGISTERED + APPROVED is blocked NOT_ACTIVE", () => {
    expect(getVehicleSelectabilityBlockers({ ...base, status: "REGISTERED" })).toEqual(["NOT_ACTIVE"]);
  });

  it("UNDER_MAINTENANCE + APPROVED is blocked NOT_ACTIVE", () => {
    expect(getVehicleSelectabilityBlockers({ ...base, status: "UNDER_MAINTENANCE" })).toEqual(["NOT_ACTIVE"]);
  });

  it("DEACTIVATED + APPROVED is blocked NOT_ACTIVE", () => {
    expect(getVehicleSelectabilityBlockers({ ...base, status: "DEACTIVATED" })).toEqual(["NOT_ACTIVE"]);
  });

  it("ACTIVE + DRAFT/SUBMITTED/CHANGES_REQUESTED/REJECTED are all blocked VERIFICATION_NOT_APPROVED", () => {
    for (const verificationStatus of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED"] as const) {
      expect(getVehicleSelectabilityBlockers({ ...base, verificationStatus })).toEqual(["VERIFICATION_NOT_APPROVED"]);
      expect(isVehicleSelectable({ ...base, verificationStatus })).toBe(false);
    }
  });

  it("VERIFIED operational status is NOT active → still blocked NOT_ACTIVE (VERIFIED is not the verification authority)", () => {
    expect(getVehicleSelectabilityBlockers({ ...base, status: "VERIFIED" })).toContain("NOT_ACTIVE");
  });
});

describe("getVehicleSelectabilityBlockers — required documents", () => {
  const withReq = (over: Partial<VehicleSelectabilityInput>): VehicleSelectabilityInput => ({
    ...base,
    requiredDocumentTypes: ["VEHICLE_INSURANCE"],
    ...over,
  });

  it("a missing required document blocks REQUIRED_DOCUMENT_MISSING", () => {
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [] }))).toEqual(["REQUIRED_DOCUMENT_MISSING"]);
  });

  it("a pending/rejected required document blocks REQUIRED_DOCUMENT_NOT_APPROVED", () => {
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [{ type: "VEHICLE_INSURANCE", status: "PENDING", expiresAt: null }] }))).toEqual([
      "REQUIRED_DOCUMENT_NOT_APPROVED",
    ]);
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [{ type: "VEHICLE_INSURANCE", status: "REJECTED", expiresAt: null }] }))).toEqual([
      "REQUIRED_DOCUMENT_NOT_APPROVED",
    ]);
  });

  it("an approved-but-EXPIRED required document blocks REQUIRED_DOCUMENT_EXPIRED (computed, no status rewrite)", () => {
    const expired = new Date("2026-08-19T23:59:00.000Z"); // before NOW
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [{ type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: expired }] }))).toEqual([
      "REQUIRED_DOCUMENT_EXPIRED",
    ]);
  });

  it("an approved, unexpired (or no-expiry) required document adds NO document blocker", () => {
    const future = new Date("2027-01-01T00:00:00.000Z");
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [{ type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: future }] }))).toEqual([]);
    expect(getVehicleSelectabilityBlockers(withReq({ documents: [{ type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: null }] }))).toEqual([]);
  });

  it("combines axes: non-ACTIVE + unverified + missing doc yields all three blocker codes in order", () => {
    expect(
      getVehicleSelectabilityBlockers({ status: "REGISTERED", verificationStatus: "DRAFT", requiredDocumentTypes: ["VEHICLE_INSURANCE"], documents: [], now: NOW }),
    ).toEqual(["NOT_ACTIVE", "VERIFICATION_NOT_APPROVED", "REQUIRED_DOCUMENT_MISSING"]);
  });
});
