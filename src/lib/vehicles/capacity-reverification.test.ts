import { describe, it, expect } from "vitest";
import {
  capacityChangeRequiresReverification,
  CAPACITY_REVERIFICATION_TRIGGER_STATUSES,
} from "./capacity-reverification";

// Phase 3C Slice B — the pure safety rule: a change to a capacity field on a trusted or
// under-review vehicle must re-open verification (so an unverified claim never masquerades
// as admin-verified). Every other case leaves verification untouched.

const B = (bookable: number | null, registered: number | null) => ({
  bookablePassengerCapacity: bookable,
  registeredSeats: registered,
});

describe("capacityChangeRequiresReverification", () => {
  it("APPROVED + bookable capacity changed → requires re-verification", () => {
    expect(capacityChangeRequiresReverification({ status: "APPROVED", before: B(6, 14), after: B(5, 14) })).toBe(true);
  });

  it("APPROVED + registered seats changed → requires re-verification", () => {
    expect(capacityChangeRequiresReverification({ status: "APPROVED", before: B(6, 14), after: B(6, 15) })).toBe(true);
  });

  it("SUBMITTED (under review) + capacity changed → requires re-verification", () => {
    expect(capacityChangeRequiresReverification({ status: "SUBMITTED", before: B(6, null), after: B(4, null) })).toBe(true);
  });

  it("APPROVED but NO capacity change (only e.g. colour edited) → does NOT re-open verification", () => {
    expect(capacityChangeRequiresReverification({ status: "APPROVED", before: B(6, 14), after: B(6, 14) })).toBe(false);
  });

  it("setting registered seats from null → a value on an APPROVED vehicle is a change → re-verifies", () => {
    expect(capacityChangeRequiresReverification({ status: "APPROVED", before: B(6, null), after: B(6, 14) })).toBe(true);
  });

  it("already-editable / untrusted states are never reset by a capacity edit", () => {
    for (const status of ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] as const) {
      expect(capacityChangeRequiresReverification({ status, before: B(6, 14), after: B(3, 9) })).toBe(false);
    }
  });

  it("only SUBMITTED and APPROVED are trigger statuses (single source of truth)", () => {
    expect([...CAPACITY_REVERIFICATION_TRIGGER_STATUSES].sort()).toEqual(["APPROVED", "SUBMITTED"]);
  });
});
