import { describe, it, expect } from "vitest";
import type { RentalOfferingStatus } from "@prisma/client";
import {
  isAllowedRentalTransition,
  isRentalOfferingArchived,
  isRentalPublishTransition,
  rentalEditRequiresLiveCompliance,
  RENTAL_EDITABLE_STATUSES,
} from "./rental-offering-lifecycle";

// Phase 3C Slice C2b-R — the pure lifecycle state machine.
//   DRAFT → PUBLISHED|ARCHIVED · PUBLISHED → SUSPENDED|ARCHIVED · SUSPENDED → PUBLISHED|ARCHIVED
//   ARCHIVED terminal.

const ALL: RentalOfferingStatus[] = ["DRAFT", "PUBLISHED", "SUSPENDED", "ARCHIVED"];
const ALLOWED = new Set([
  "DRAFT>PUBLISHED",
  "DRAFT>ARCHIVED",
  "PUBLISHED>SUSPENDED",
  "PUBLISHED>ARCHIVED",
  "SUSPENDED>PUBLISHED",
  "SUSPENDED>ARCHIVED",
]);

describe("isAllowedRentalTransition — exhaustive matrix", () => {
  it("allows exactly the locked transitions and nothing else (same-state is not a transition)", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(isAllowedRentalTransition(from, to)).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
  });
  it("ARCHIVED is terminal — no outgoing transition", () => {
    for (const to of ALL) expect(isAllowedRentalTransition("ARCHIVED", to)).toBe(false);
  });
  it("same-state is never reported as a transition", () => {
    for (const s of ALL) expect(isAllowedRentalTransition(s, s)).toBe(false);
  });
});

describe("isRentalOfferingArchived", () => {
  it("true only for ARCHIVED", () => {
    expect(isRentalOfferingArchived("ARCHIVED")).toBe(true);
    for (const s of ["DRAFT", "PUBLISHED", "SUSPENDED"] as RentalOfferingStatus[]) {
      expect(isRentalOfferingArchived(s)).toBe(false);
    }
  });
});

describe("isRentalPublishTransition", () => {
  it("true only when the target is PUBLISHED", () => {
    expect(isRentalPublishTransition("PUBLISHED")).toBe(true);
    for (const s of ["DRAFT", "SUSPENDED", "ARCHIVED"] as RentalOfferingStatus[]) {
      expect(isRentalPublishTransition(s)).toBe(false);
    }
  });
});

describe("content-edit gating", () => {
  it("editable content statuses are DRAFT, PUBLISHED, SUSPENDED (never ARCHIVED)", () => {
    expect([...RENTAL_EDITABLE_STATUSES].sort()).toEqual(["DRAFT", "PUBLISHED", "SUSPENDED"]);
    expect(RENTAL_EDITABLE_STATUSES).not.toContain("ARCHIVED");
  });
  it("only a PUBLISHED edit re-runs full live compliance", () => {
    expect(rentalEditRequiresLiveCompliance("PUBLISHED")).toBe(true);
    expect(rentalEditRequiresLiveCompliance("DRAFT")).toBe(false);
    expect(rentalEditRequiresLiveCompliance("SUSPENDED")).toBe(false);
    expect(rentalEditRequiresLiveCompliance("ARCHIVED")).toBe(false);
  });
});
