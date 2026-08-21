import { describe, it, expect } from "vitest";
import { getVehicleAssignmentBlockers, isVehicleAssignable, type VehicleAssignmentInput } from "./vehicle-assignment";

// Required VEHICLE doc types are VEHICLE_REGISTRATION + VEHICLE_INSURANCE; "ready" means
// both APPROVED and unexpired. The clock is pinned for deterministic expiry.
const NOW = new Date("2026-08-22T00:00:00.000Z");
const FUTURE = new Date("2027-01-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

const READY_DOCS = [
  { type: "VEHICLE_REGISTRATION", status: "APPROVED" as const, expiresAt: FUTURE },
  { type: "VEHICLE_INSURANCE", status: "APPROVED" as const, expiresAt: FUTURE },
];
const REQUIRED = ["VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"];

// A ready, transport-package baseline; each test overrides only what it exercises.
function base(overrides: Partial<VehicleAssignmentInput> = {}): VehicleAssignmentInput {
  return {
    packageType: "GUIDE_WITH_TRANSPORT",
    status: "ACTIVE",
    verificationStatus: "APPROVED",
    fourByFourVerified: null,
    guestCapacity: 6,
    serviceMaxGuests: null,
    requiredDocumentTypes: REQUIRED,
    documents: READY_DOCS,
    now: NOW,
    ...overrides,
  };
}

describe("getVehicleAssignmentBlockers — TOUR-VEHICLE-1 eligibility truth table", () => {
  it("A. owned + ACTIVE + APPROVED + valid docs + GUIDE_WITH_TRANSPORT => eligible", () => {
    expect(getVehicleAssignmentBlockers(base())).toEqual([]);
    expect(isVehicleAssignable(base())).toBe(true);
  });

  it("B. REGISTERED (not yet activated) + otherwise ready => blocked NOT_ACTIVE", () => {
    expect(getVehicleAssignmentBlockers(base({ status: "REGISTERED" }))).toContain("NOT_ACTIVE");
    expect(isVehicleAssignable(base({ status: "REGISTERED" }))).toBe(false);
  });

  it("C. ACTIVE + verification SUBMITTED => blocked VERIFICATION_NOT_APPROVED", () => {
    expect(getVehicleAssignmentBlockers(base({ verificationStatus: "SUBMITTED" }))).toContain("VERIFICATION_NOT_APPROVED");
  });

  it("D. ACTIVE + APPROVED + expired required doc => blocked REQUIRED_DOCUMENT_EXPIRED", () => {
    const docs = [
      { type: "VEHICLE_REGISTRATION", status: "APPROVED" as const, expiresAt: PAST },
      { type: "VEHICLE_INSURANCE", status: "APPROVED" as const, expiresAt: FUTURE },
    ];
    expect(getVehicleAssignmentBlockers(base({ documents: docs }))).toContain("REQUIRED_DOCUMENT_EXPIRED");
  });

  it("D2. missing / unapproved required doc => blocked", () => {
    expect(getVehicleAssignmentBlockers(base({ documents: [READY_DOCS[0]!] }))).toContain("REQUIRED_DOCUMENT_MISSING");
    const pending = [READY_DOCS[0]!, { type: "VEHICLE_INSURANCE", status: "PENDING" as const, expiresAt: FUTURE }];
    expect(getVehicleAssignmentBlockers(base({ documents: pending }))).toContain("REQUIRED_DOCUMENT_NOT_APPROVED");
  });

  it("E. GUIDE_WITH_4X4 + trusted 4x4 true + all ready => eligible", () => {
    expect(getVehicleAssignmentBlockers(base({ packageType: "GUIDE_WITH_4X4", fourByFourVerified: true }))).toEqual([]);
  });

  it("F. GUIDE_WITH_4X4 + provider claim true but trusted null => blocked NOT_FOUR_BY_FOUR_CAPABLE (claim never qualifies)", () => {
    // Note: the input carries NO claimedFourByFour/vehicleType — the authority structurally
    // cannot read them; only the trusted flag decides.
    expect(getVehicleAssignmentBlockers(base({ packageType: "GUIDE_WITH_4X4", fourByFourVerified: null }))).toContain(
      "NOT_FOUR_BY_FOUR_CAPABLE",
    );
  });

  it("G. GUIDE_WITH_4X4 + trusted false => blocked (an SUV / FOUR_BY_FOUR type code can never substitute)", () => {
    expect(getVehicleAssignmentBlockers(base({ packageType: "GUIDE_WITH_4X4", fourByFourVerified: false }))).toContain(
      "NOT_FOUR_BY_FOUR_CAPABLE",
    );
  });

  it("H. GUIDE_WITH_TRANSPORT + trusted 4x4 false => still eligible (4x4 not required)", () => {
    expect(getVehicleAssignmentBlockers(base({ packageType: "GUIDE_WITH_TRANSPORT", fourByFourVerified: false }))).toEqual([]);
  });

  it("J. GUIDE_ONLY => PACKAGE_FORBIDS_VEHICLE (sole blocker, short-circuit)", () => {
    // Even a fully-ready, trusted-4x4 vehicle cannot be pooled on a guide-only tour.
    const forbidden = getVehicleAssignmentBlockers(base({ packageType: "GUIDE_ONLY", fourByFourVerified: true }));
    expect(forbidden).toEqual(["PACKAGE_FORBIDS_VEHICLE"]);
  });

  it("PRIVATE_CUSTOM_TOUR (vehicle optional) => vehicle allowed, 4x4 not required", () => {
    expect(getVehicleAssignmentBlockers(base({ packageType: "PRIVATE_CUSTOM_TOUR", fourByFourVerified: null }))).toEqual([]);
  });
});

describe("getVehicleAssignmentBlockers — guest-capacity enforcement (locked guest semantic)", () => {
  it("no declared maxGuests => capacity is never enforced (even when capacity is unknown)", () => {
    expect(getVehicleAssignmentBlockers(base({ serviceMaxGuests: null, guestCapacity: null }))).toEqual([]);
  });

  it("capacity >= maxGuests => eligible; capacity < maxGuests => INSUFFICIENT_GUEST_CAPACITY", () => {
    expect(getVehicleAssignmentBlockers(base({ serviceMaxGuests: 6, guestCapacity: 6 }))).toEqual([]);
    expect(getVehicleAssignmentBlockers(base({ serviceMaxGuests: 6, guestCapacity: 4 }))).toContain("INSUFFICIENT_GUEST_CAPACITY");
  });

  it("maxGuests declared but vehicle capacity unknown => fail-closed INSUFFICIENT_GUEST_CAPACITY", () => {
    expect(getVehicleAssignmentBlockers(base({ serviceMaxGuests: 6, guestCapacity: null }))).toContain("INSUFFICIENT_GUEST_CAPACITY");
  });
});
