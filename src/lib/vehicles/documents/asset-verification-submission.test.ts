import { describe, it, expect } from "vitest";
import { getVehicleVerificationSubmissionBlockers } from "./asset-verification-submission";

// Presence-only readiness: a required doc must EXIST and not be REJECTED. PENDING
// and APPROVED both satisfy submission — the gate deliberately does NOT require
// APPROVED (that is admin review + customer selectability, a later axis).

const REQUIRED = ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"] as const;

describe("getVehicleVerificationSubmissionBlockers", () => {
  it("no blockers when every required doc is PENDING", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(REQUIRED, [
      { type: "VEHICLE_REGISTRATION", status: "PENDING" },
      { type: "VEHICLE_INSURANCE", status: "PENDING" },
    ]);
    expect(blockers).toEqual([]);
  });

  it("no blockers when every required doc is APPROVED", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(REQUIRED, [
      { type: "VEHICLE_REGISTRATION", status: "APPROVED" },
      { type: "VEHICLE_INSURANCE", status: "APPROVED" },
    ]);
    expect(blockers).toEqual([]);
  });

  it("MISSING blocker for an absent required doc", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(REQUIRED, [{ type: "VEHICLE_REGISTRATION", status: "PENDING" }]);
    expect(blockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "MISSING" }]);
  });

  it("REJECTED blocker for a rejected required doc (must be replaced first)", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(REQUIRED, [
      { type: "VEHICLE_REGISTRATION", status: "PENDING" },
      { type: "VEHICLE_INSURANCE", status: "REJECTED" },
    ]);
    expect(blockers).toEqual([{ type: "VEHICLE_INSURANCE", reason: "REJECTED" }]);
  });

  it("reports multiple blockers when nothing is uploaded", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(REQUIRED, []);
    expect(blockers).toHaveLength(2);
    expect(blockers.every((b) => b.reason === "MISSING")).toBe(true);
  });

  it("ignores documents of non-required types", () => {
    const blockers = getVehicleVerificationSubmissionBlockers(["VEHICLE_REGISTRATION"], [
      { type: "VEHICLE_REGISTRATION", status: "PENDING" },
      { type: "SOMETHING_ELSE", status: "REJECTED" },
    ]);
    expect(blockers).toEqual([]);
  });

  it("no blockers when nothing is required", () => {
    expect(getVehicleVerificationSubmissionBlockers([], [])).toEqual([]);
  });
});
