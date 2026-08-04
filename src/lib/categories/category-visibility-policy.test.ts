import { describe, it, expect, vi } from "vitest";

// Phase 1.1 (Core Business Platform) — regression test for the Category/
// SubCategory visibility transition matrix, mirroring
// service-status-policy.test.ts's shape.

vi.mock("server-only", () => ({}));

const { canTransitionCategoryVisibility, isValidScheduledVisibility, isCategoryEffectivelyVisible } = await import(
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

describe("isCategoryEffectivelyVisible", () => {
  it("treats a root (no ancestors) as visible iff it is itself PUBLIC", () => {
    expect(isCategoryEffectivelyVisible("PUBLIC")).toBe(true);
    expect(isCategoryEffectivelyVisible("PUBLIC", [])).toBe(true);
    expect(isCategoryEffectivelyVisible("HIDDEN")).toBe(false);
    expect(isCategoryEffectivelyVisible("LINK_ONLY")).toBe(false);
  });

  it("is invisible when any ancestor is HIDDEN, regardless of the node's own status", () => {
    expect(isCategoryEffectivelyVisible("PUBLIC", ["HIDDEN"])).toBe(false);
  });

  it("is invisible when any ancestor is ARCHIVED, regardless of the node's own status", () => {
    expect(isCategoryEffectivelyVisible("PUBLIC", ["ARCHIVED"])).toBe(false);
  });

  it("is visible only when the node is PUBLIC and no ancestor is HIDDEN/ARCHIVED", () => {
    expect(isCategoryEffectivelyVisible("PUBLIC", ["PUBLIC"])).toBe(true);
    expect(isCategoryEffectivelyVisible("HIDDEN", ["PUBLIC"])).toBe(false);
    expect(isCategoryEffectivelyVisible("LINK_ONLY", ["PUBLIC"])).toBe(false);
  });

  it("evaluates EVERY ancestor — one HIDDEN/ARCHIVED ancestor anywhere hides the node", () => {
    expect(isCategoryEffectivelyVisible("PUBLIC", ["PUBLIC", "PUBLIC"])).toBe(true);
    expect(isCategoryEffectivelyVisible("PUBLIC", ["PUBLIC", "HIDDEN"])).toBe(false);
    expect(isCategoryEffectivelyVisible("PUBLIC", ["ARCHIVED", "PUBLIC"])).toBe(false);
  });
});
