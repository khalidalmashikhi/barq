import { describe, it, expect } from "vitest";
import { getVehicleVerificationApprovalBlockers } from "./get-vehicle-verification-approval-blockers";

const bothApproved = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED" as const, expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED" as const, expiresAt: new Date("2999-01-01T00:00:00Z") },
];

describe("getVehicleVerificationApprovalBlockers", () => {
  it("no blockers when SUBMITTED + vehicle data + all required docs APPROVED & unexpired", () => {
    expect(getVehicleVerificationApprovalBlockers({ verificationStatus: "SUBMITTED", hasVehicleData: true, documents: bothApproved })).toEqual([]);
  });

  it("MISSING when a required document is absent", () => {
    const blockers = getVehicleVerificationApprovalBlockers({
      verificationStatus: "SUBMITTED",
      hasVehicleData: true,
      documents: [{ type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null }],
    });
    expect(blockers).toContainEqual({ type: "VEHICLE_INSURANCE", reason: "REQUIRED_DOCUMENT_MISSING" });
  });

  it("NOT_APPROVED when a required document is PENDING", () => {
    const blockers = getVehicleVerificationApprovalBlockers({
      verificationStatus: "SUBMITTED",
      hasVehicleData: true,
      documents: [{ type: "VEHICLE_REGISTRATION", status: "PENDING", expiresAt: null }, bothApproved[1]!],
    });
    expect(blockers).toContainEqual({ type: "VEHICLE_REGISTRATION", reason: "REQUIRED_DOCUMENT_NOT_APPROVED" });
  });

  it("NOT_APPROVED when a required document is REJECTED", () => {
    const blockers = getVehicleVerificationApprovalBlockers({
      verificationStatus: "SUBMITTED",
      hasVehicleData: true,
      documents: [{ type: "VEHICLE_REGISTRATION", status: "REJECTED", expiresAt: null }, bothApproved[1]!],
    });
    expect(blockers).toContainEqual({ type: "VEHICLE_REGISTRATION", reason: "REQUIRED_DOCUMENT_NOT_APPROVED" });
  });

  it("EXPIRED when an APPROVED required document is past its expiry", () => {
    const blockers = getVehicleVerificationApprovalBlockers({
      verificationStatus: "SUBMITTED",
      hasVehicleData: true,
      documents: [bothApproved[0]!, { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2000-01-01T00:00:00Z") }],
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(blockers).toContainEqual({ type: "VEHICLE_INSURANCE", reason: "REQUIRED_DOCUMENT_EXPIRED" });
  });

  it("INVALID_VERIFICATION_STATE when not SUBMITTED (e.g. DRAFT)", () => {
    const blockers = getVehicleVerificationApprovalBlockers({ verificationStatus: "DRAFT", hasVehicleData: true, documents: bothApproved });
    expect(blockers).toContainEqual({ type: "", reason: "INVALID_VERIFICATION_STATE" });
  });

  it("INVALID_VEHICLE_DATA when the vehicle detail row is missing", () => {
    const blockers = getVehicleVerificationApprovalBlockers({ verificationStatus: "SUBMITTED", hasVehicleData: false, documents: bothApproved });
    expect(blockers).toContainEqual({ type: "", reason: "INVALID_VEHICLE_DATA" });
  });
});
