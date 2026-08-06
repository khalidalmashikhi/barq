import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { selectableCategoryWhere, isCategoryEffectivelySelectable } = await import("./selectable-category-rule");

describe("selectableCategoryWhere", () => {
  it("filters to own-PUBLIC status and the given serviceType", () => {
    expect(selectableCategoryWhere("EXPERIENCE")).toEqual({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE" });
  });
});

describe("isCategoryEffectivelySelectable", () => {
  it("accepts a PUBLIC root of the matching serviceType", () => {
    expect(isCategoryEffectivelySelectable({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE" }, "EXPERIENCE")).toBe(true);
  });

  it("accepts a PUBLIC child under a PUBLIC parent", () => {
    expect(
      isCategoryEffectivelySelectable(
        { visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", ancestorStatuses: ["PUBLIC"] },
        "EXPERIENCE"
      )
    ).toBe(true);
  });

  it("rejects a PUBLIC child under a HIDDEN parent (effective visibility)", () => {
    expect(
      isCategoryEffectivelySelectable(
        { visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", ancestorStatuses: ["HIDDEN"] },
        "EXPERIENCE"
      )
    ).toBe(false);
  });

  it("rejects a PUBLIC child under an ARCHIVED parent", () => {
    expect(
      isCategoryEffectivelySelectable(
        { visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE", ancestorStatuses: ["ARCHIVED"] },
        "EXPERIENCE"
      )
    ).toBe(false);
  });

  it("rejects a non-PUBLIC own status", () => {
    expect(isCategoryEffectivelySelectable({ visibilityStatus: "HIDDEN", serviceTypeKey: "EXPERIENCE" }, "EXPERIENCE")).toBe(false);
  });

  it("rejects a serviceType mismatch", () => {
    expect(isCategoryEffectivelySelectable({ visibilityStatus: "PUBLIC", serviceTypeKey: "TRANSPORT" }, "EXPERIENCE")).toBe(false);
  });
});
