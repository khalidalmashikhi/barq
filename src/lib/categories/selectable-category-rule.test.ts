import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { selectableCategoryWhere, isCategoryEffectivelySelectable } = await import("./selectable-category-rule");

describe("selectableCategoryWhere", () => {
  it("filters to own-PUBLIC status and the given serviceType", () => {
    expect(selectableCategoryWhere("EXPERIENCE")).toEqual({ visibilityStatus: "PUBLIC", serviceTypeKey: "EXPERIENCE" });
  });

  it("filters to own-PUBLIC only (no vertical) when serviceType is omitted — the unified set (BR-028)", () => {
    expect(selectableCategoryWhere()).toEqual({ visibilityStatus: "PUBLIC" });
    expect(selectableCategoryWhere()).not.toHaveProperty("serviceTypeKey");
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

  describe("unified set (serviceType omitted — BR-028)", () => {
    it("accepts any GOVERNED vertical (RENTAL/TRANSPORT/EXPERIENCE) that is effectively PUBLIC", () => {
      for (const key of ["RENTAL", "TRANSPORT", "EXPERIENCE"]) {
        expect(isCategoryEffectivelySelectable({ visibilityStatus: "PUBLIC", serviceTypeKey: key })).toBe(true);
      }
    });

    it("accepts a PUBLIC RENTAL child under a PUBLIC parent", () => {
      expect(
        isCategoryEffectivelySelectable(
          { visibilityStatus: "PUBLIC", serviceTypeKey: "RENTAL", ancestorStatuses: ["PUBLIC"] }
        )
      ).toBe(true);
    });

    it("still rejects a non-governed serviceTypeKey (no leak of unrecognized verticals)", () => {
      expect(isCategoryEffectivelySelectable({ visibilityStatus: "PUBLIC", serviceTypeKey: "BOGUS" })).toBe(false);
    });

    it("still rejects a non-PUBLIC own status", () => {
      expect(isCategoryEffectivelySelectable({ visibilityStatus: "HIDDEN", serviceTypeKey: "RENTAL" })).toBe(false);
    });

    it("still rejects a PUBLIC child under a HIDDEN/ARCHIVED parent (effective visibility)", () => {
      expect(
        isCategoryEffectivelySelectable({ visibilityStatus: "PUBLIC", serviceTypeKey: "TRANSPORT", ancestorStatuses: ["ARCHIVED"] })
      ).toBe(false);
    });
  });
});
