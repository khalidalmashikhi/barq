import { describe, it, expect, vi } from "vitest";

// Phase 1.1 (Core Business Platform) — regression test for the Category/
// SubCategory visibility transition matrix, mirroring
// service-status-policy.test.ts's shape.

vi.mock("server-only", () => ({}));

const { canTransitionCategoryVisibility, isValidScheduledVisibility, isSubCategoryEffectivelyVisible } = await import(
  "./category-visibility-policy"
);

describe("canTransitionCategoryVisibility", () => {
  it("allows HIDDEN to transition to any other state", () => {
    expect(canTransitionCategoryVisibility("HIDDEN", "PUBLIC")).toBe(true);
    expect(canTransitionCategoryVisibility("HIDDEN", "LINK_ONLY")).toBe(true);
    expect(canTransitionCategoryVisibility("HIDDEN", "INVITE_ONLY")).toBe(true);
    expect(canTransitionCategoryVisibility("HIDDEN", "SCHEDULED")).toBe(true);
    expect(canTransitionCategoryVisibility("HIDDEN", "ARCHIVED")).toBe(true);
  });

  it("allows PUBLIC to move back to HIDDEN or into ARCHIVED, but not to SCHEDULED", () => {
    expect(canTransitionCategoryVisibility("PUBLIC", "HIDDEN")).toBe(true);
    expect(canTransitionCategoryVisibility("PUBLIC", "ARCHIVED")).toBe(true);
    expect(canTransitionCategoryVisibility("PUBLIC", "SCHEDULED")).toBe(false);
  });

  it("treats ARCHIVED as terminal", () => {
    expect(canTransitionCategoryVisibility("ARCHIVED", "PUBLIC")).toBe(false);
    expect(canTransitionCategoryVisibility("ARCHIVED", "HIDDEN")).toBe(false);
    expect(canTransitionCategoryVisibility("ARCHIVED", "ARCHIVED")).toBe(false);
  });
});

describe("isValidScheduledVisibility", () => {
  it("rejects null/undefined", () => {
    expect(isValidScheduledVisibility(null)).toBe(false);
    expect(isValidScheduledVisibility(undefined)).toBe(false);
  });

  it("rejects a past date", () => {
    expect(isValidScheduledVisibility(new Date(Date.now() - 60_000))).toBe(false);
  });

  it("accepts a future date", () => {
    expect(isValidScheduledVisibility(new Date(Date.now() + 60_000))).toBe(true);
  });
});

describe("isSubCategoryEffectivelyVisible", () => {
  it("is invisible when the parent Category is HIDDEN, regardless of the SubCategory's own status", () => {
    expect(isSubCategoryEffectivelyVisible("PUBLIC", "HIDDEN")).toBe(false);
  });

  it("is invisible when the parent Category is ARCHIVED, regardless of the SubCategory's own status", () => {
    expect(isSubCategoryEffectivelyVisible("PUBLIC", "ARCHIVED")).toBe(false);
  });

  it("is visible only when both the SubCategory and its parent are PUBLIC", () => {
    expect(isSubCategoryEffectivelyVisible("PUBLIC", "PUBLIC")).toBe(true);
    expect(isSubCategoryEffectivelyVisible("HIDDEN", "PUBLIC")).toBe(false);
    expect(isSubCategoryEffectivelyVisible("LINK_ONLY", "PUBLIC")).toBe(false);
  });
});
