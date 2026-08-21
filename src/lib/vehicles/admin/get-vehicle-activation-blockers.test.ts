import { describe, it, expect } from "vitest";
import { getVehicleActivationBlockers, ACTIVATABLE_SOURCE_STATUS } from "./get-vehicle-activation-blockers";

// VEHICLE-LC7 — the activation-readiness truth table.
const READY_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED" as const, expiresAt: null },
  { type: "VEHICLE_INSURANCE", status: "APPROVED" as const, expiresAt: null },
];

const base = (over: Partial<Parameters<typeof getVehicleActivationBlockers>[0]> = {}) =>
  getVehicleActivationBlockers({
    operationalStatus: "REGISTERED",
    verificationStatus: "APPROVED",
    hasVehicleData: true,
    documents: READY_DOCS,
    ...over,
  });

describe("getVehicleActivationBlockers", () => {
  it("no blockers for REGISTERED + APPROVED + all required docs approved & unexpired", () => {
    expect(base()).toEqual([]);
    expect(ACTIVATABLE_SOURCE_STATUS).toBe("REGISTERED");
  });

  it("INVALID_OPERATIONAL_STATE for any non-REGISTERED source (ACTIVE / VERIFIED / etc.)", () => {
    for (const operationalStatus of ["ACTIVE", "VERIFIED", "UNDER_MAINTENANCE", "DEACTIVATED"] as const) {
      expect(base({ operationalStatus })).toContainEqual({ type: "", reason: "INVALID_OPERATIONAL_STATE" });
    }
  });

  it("VERIFICATION_NOT_APPROVED unless verificationStatus is APPROVED", () => {
    for (const verificationStatus of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED"] as const) {
      expect(base({ verificationStatus })).toContainEqual({ type: "", reason: "VERIFICATION_NOT_APPROVED" });
    }
  });

  it("INVALID_VEHICLE_DATA when the vehicle detail row is missing", () => {
    expect(base({ hasVehicleData: false })).toContainEqual({ type: "", reason: "INVALID_VEHICLE_DATA" });
  });

  it("REQUIRED_DOCUMENT_MISSING / NOT_APPROVED / EXPIRED per required document", () => {
    expect(base({ documents: [READY_DOCS[0]!] })).toContainEqual({ type: "VEHICLE_INSURANCE", reason: "REQUIRED_DOCUMENT_MISSING" });
    expect(base({ documents: [{ type: "VEHICLE_REGISTRATION", status: "PENDING", expiresAt: null }, READY_DOCS[1]!] })).toContainEqual({ type: "VEHICLE_REGISTRATION", reason: "REQUIRED_DOCUMENT_NOT_APPROVED" });
    expect(base({ documents: [{ type: "VEHICLE_REGISTRATION", status: "REJECTED", expiresAt: null }, READY_DOCS[1]!] })).toContainEqual({ type: "VEHICLE_REGISTRATION", reason: "REQUIRED_DOCUMENT_NOT_APPROVED" });
    expect(
      base({
        documents: [READY_DOCS[0]!, { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2000-01-01T00:00:00Z") }],
        now: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toContainEqual({ type: "VEHICLE_INSURANCE", reason: "REQUIRED_DOCUMENT_EXPIRED" });
  });

  it("an expired required doc blocks even when everything else is ready (fail-closed)", () => {
    const blockers = base({
      documents: [{ type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: new Date("2000-01-01T00:00:00Z") }, READY_DOCS[1]!],
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(blockers).toContainEqual({ type: "VEHICLE_REGISTRATION", reason: "REQUIRED_DOCUMENT_EXPIRED" });
  });
});
