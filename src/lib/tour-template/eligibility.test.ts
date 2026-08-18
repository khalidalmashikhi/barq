import { describe, it, expect } from "vitest";
import { isSmartTourGuideEligible, TOURIST_GUIDE_CATEGORY_SLUG } from "./eligibility";

// Pure eligibility predicate — id-equality only (INDIVIDUAL + the canonical
// tourist-guide category id). No name/string matching, fail-closed on nulls.

const TG = "cat-tourist-guides";
const OTHER = "cat-other";

describe("isSmartTourGuideEligible", () => {
  it("INDIVIDUAL + the canonical tourist-guide category id → eligible", () => {
    expect(isSmartTourGuideEligible({ providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG })).toBe(true);
  });

  it("COMPANY + the same category → NOT eligible", () => {
    expect(isSmartTourGuideEligible({ providerType: "COMPANY", categoryId: TG, touristGuideCategoryId: TG })).toBe(false);
  });

  it("INDIVIDUAL + a different category → NOT eligible", () => {
    expect(isSmartTourGuideEligible({ providerType: "INDIVIDUAL", categoryId: OTHER, touristGuideCategoryId: TG })).toBe(false);
  });

  it("a name-lookalike cannot trigger eligibility — matching is by id, a different id is rejected", () => {
    expect(isSmartTourGuideEligible({ providerType: "INDIVIDUAL", categoryId: OTHER, touristGuideCategoryId: TG })).toBe(false);
  });

  it("fails closed when the canonical category is unresolved (null) or the service is uncategorized", () => {
    expect(isSmartTourGuideEligible({ providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: null })).toBe(false);
    expect(isSmartTourGuideEligible({ providerType: "INDIVIDUAL", categoryId: null, touristGuideCategoryId: TG })).toBe(false);
  });

  it("exposes the stable slug identity", () => {
    expect(TOURIST_GUIDE_CATEGORY_SLUG).toBe("tourist-guides");
  });
});
