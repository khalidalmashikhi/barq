import { describe, it, expect } from "vitest";
import {
  discoveryGroupForCategorySlug,
  isExperienceCategorySlug,
  isProfessionalServiceCategorySlug,
} from "./classification";
import { DISCOVERY_GROUP_KEYS, DISCOVERY_GROUPS } from "./discovery-groups";

// Product-semantics classification (by STABLE slug, never label or serviceTypeKey).

describe("discovery-group registry", () => {
  it("has exactly the six canonical groups in sort order", () => {
    expect([...DISCOVERY_GROUP_KEYS]).toEqual([
      "EXPERIENCES",
      "TOURIST_GUIDES",
      "TRANSPORT",
      "CAR_RENTAL",
      "MARINE_TRIPS",
      "MORE",
    ]);
    expect(DISCOVERY_GROUPS.map((g) => g.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("discoveryGroupForCategorySlug (fail-closed, slug-keyed)", () => {
  it("maps each real slug to its product group", () => {
    expect(discoveryGroupForCategorySlug("tourist-guides")).toBe("TOURIST_GUIDES");
    expect(discoveryGroupForCategorySlug("adventures")).toBe("EXPERIENCES");
    expect(discoveryGroupForCategorySlug("local-experiences")).toBe("EXPERIENCES");
    expect(discoveryGroupForCategorySlug("cultural-tours")).toBe("EXPERIENCES");
    expect(discoveryGroupForCategorySlug("transfers")).toBe("TRANSPORT");
    expect(discoveryGroupForCategorySlug("cars")).toBe("CAR_RENTAL");
    expect(discoveryGroupForCategorySlug("marine-trips")).toBe("MARINE_TRIPS");
  });

  it("returns null for an unknown slug (fail-closed)", () => {
    expect(discoveryGroupForCategorySlug("restaurants")).toBeNull();
    expect(discoveryGroupForCategorySlug("")).toBeNull();
  });

  it("a translated label can never classify — only the stable slug does", () => {
    // Arabic/English display names are NOT slugs, so they never match a group.
    expect(discoveryGroupForCategorySlug("مرشدون سياحيون")).toBeNull();
    expect(discoveryGroupForCategorySlug("Tourist Guides")).toBeNull();
  });
});

describe("isExperienceCategorySlug — the key anti-regression", () => {
  it("tourist-guides is NOT a customer-facing Experience (even though serviceTypeKey=EXPERIENCE)", () => {
    expect(isExperienceCategorySlug("tourist-guides")).toBe(false);
  });

  it("real experiences ARE experiences", () => {
    expect(isExperienceCategorySlug("adventures")).toBe(true);
    expect(isExperienceCategorySlug("local-experiences")).toBe(true);
    expect(isExperienceCategorySlug("cultural-tours")).toBe(true);
  });

  it("marine-trips / transfers / cars are NOT the Experiences group", () => {
    expect(isExperienceCategorySlug("marine-trips")).toBe(false); // its own MARINE_TRIPS group
    expect(isExperienceCategorySlug("transfers")).toBe(false);
    expect(isExperienceCategorySlug("cars")).toBe(false);
    expect(isExperienceCategorySlug("unknown")).toBe(false);
  });
});

describe("isProfessionalServiceCategorySlug", () => {
  it("classifies guide/transport/car-rental as professional services", () => {
    expect(isProfessionalServiceCategorySlug("tourist-guides")).toBe(true);
    expect(isProfessionalServiceCategorySlug("transfers")).toBe(true);
    expect(isProfessionalServiceCategorySlug("cars")).toBe(true);
    expect(isProfessionalServiceCategorySlug("adventures")).toBe(false);
  });
});
