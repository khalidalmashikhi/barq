import { describe, it, expect } from "vitest";
import {
  VERTICAL_FOR_OFFERING_KIND,
  requiredVerticalForOfferingKind,
  offeringKindForServiceType,
  isRegulatedOfferingKind,
  canCreateDraftWithVerticalStatus,
  canPublishWithVerticalStatus,
  canTransitionVertical,
} from "./vertical-policy";
import type { ProviderVerticalStatus } from "@prisma/client";

// Phase 3B — Phase 1. Pure policy unit tests: the single authority every server guard, action,
// API route and test shares. No I/O, no mocks — just the mapping, the status predicates, and the
// transition graph. Each rule the product decisions pinned is asserted here explicitly.

describe("vertical-policy — offering ↔ vertical mapping", () => {
  it("maps each regulated offering kind to exactly one vertical", () => {
    expect(VERTICAL_FOR_OFFERING_KIND).toEqual({ TOUR: "TOURIST_GUIDE", VEHICLE_RENTAL: "RENTAL_COMPANY" });
    expect(requiredVerticalForOfferingKind("TOUR")).toBe("TOURIST_GUIDE");
    expect(requiredVerticalForOfferingKind("VEHICLE_RENTAL")).toBe("RENTAL_COMPANY");
  });

  it("treats both TOUR and VEHICLE_RENTAL as regulated, and null/undefined as unregulated", () => {
    expect(isRegulatedOfferingKind("TOUR")).toBe(true);
    expect(isRegulatedOfferingKind("VEHICLE_RENTAL")).toBe(true);
    expect(isRegulatedOfferingKind(null)).toBe(false);
    expect(isRegulatedOfferingKind(undefined)).toBe(false);
  });
});

describe("vertical-policy — offeringKindForServiceType (auto-classification)", () => {
  it("derives VEHICLE_RENTAL ONLY from a RENTAL serviceType", () => {
    expect(offeringKindForServiceType("RENTAL")).toBe("VEHICLE_RENTAL");
  });

  it("NEVER auto-classifies a generic EXPERIENCE (or any non-RENTAL type) as a regulated TOUR", () => {
    // The binding correction: do not classify all EXPERIENCE services as TOUR. Tour
    // classification arrives explicitly with the later tour engine, never inferred here.
    expect(offeringKindForServiceType("EXPERIENCE")).toBeNull();
    expect(offeringKindForServiceType("TRANSPORT")).toBeNull();
    expect(offeringKindForServiceType("ACCOMMODATION")).toBeNull();
    expect(offeringKindForServiceType("")).toBeNull();
  });
});

describe("vertical-policy — draft vs publish status predicates", () => {
  it("permits DRAFT preparation while PENDING_REVIEW / CHANGES_REQUESTED / APPROVED", () => {
    expect(canCreateDraftWithVerticalStatus("PENDING_REVIEW")).toBe(true);
    expect(canCreateDraftWithVerticalStatus("CHANGES_REQUESTED")).toBe(true);
    expect(canCreateDraftWithVerticalStatus("APPROVED")).toBe(true);
  });

  it("forbids DRAFT preparation while REJECTED or SUSPENDED", () => {
    expect(canCreateDraftWithVerticalStatus("REJECTED")).toBe(false);
    expect(canCreateDraftWithVerticalStatus("SUSPENDED")).toBe(false);
  });

  it("permits PUBLISH only while APPROVED — nothing weaker", () => {
    expect(canPublishWithVerticalStatus("APPROVED")).toBe(true);
    for (const s of ["PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED"] as ProviderVerticalStatus[]) {
      expect(canPublishWithVerticalStatus(s)).toBe(false);
    }
  });
});

describe("vertical-policy — canTransitionVertical (review state graph)", () => {
  it("allows the review decisions from PENDING_REVIEW", () => {
    expect(canTransitionVertical("PENDING_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionVertical("PENDING_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(canTransitionVertical("PENDING_REVIEW", "REJECTED")).toBe(true);
  });

  it("allows resubmission from CHANGES_REQUESTED / REJECTED back to PENDING_REVIEW", () => {
    expect(canTransitionVertical("CHANGES_REQUESTED", "PENDING_REVIEW")).toBe(true);
    expect(canTransitionVertical("REJECTED", "PENDING_REVIEW")).toBe(true);
  });

  it("allows suspend from APPROVED and reactivate from SUSPENDED, and nothing else on those", () => {
    expect(canTransitionVertical("APPROVED", "SUSPENDED")).toBe(true);
    expect(canTransitionVertical("SUSPENDED", "APPROVED")).toBe(true);
    // No direct APPROVED → REJECTED, no SUSPENDED → REJECTED, no self-loops.
    expect(canTransitionVertical("APPROVED", "REJECTED")).toBe(false);
    expect(canTransitionVertical("SUSPENDED", "REJECTED")).toBe(false);
    expect(canTransitionVertical("APPROVED", "APPROVED")).toBe(false);
  });

  it("forbids transitions OUT of a terminal-for-now REJECTED except resubmit", () => {
    expect(canTransitionVertical("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionVertical("REJECTED", "SUSPENDED")).toBe(false);
  });
});
