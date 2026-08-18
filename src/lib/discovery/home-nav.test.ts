import { describe, it, expect } from "vitest";
import {
  discoveryGroupHref,
  serviceCardHref,
  governorateBrowseHref,
  homeGovernorateHref,
  discoveryNavItems,
  categorySlugsForGroup,
} from "./home-nav";

describe("home-nav — discovery href builders (pure routing)", () => {
  it("a normal group carries ?group=<KEY>; a governorate is appended as an AND scope", () => {
    expect(discoveryGroupHref("EXPERIENCES")).toBe("/services?group=EXPERIENCES");
    expect(discoveryGroupHref("EXPERIENCES", "DHOFAR")).toBe("/services?group=EXPERIENCES&region=DHOFAR");
  });

  it("MORE is the browse-everything catch-all — NEVER a ?group= bucket", () => {
    expect(discoveryGroupHref("MORE")).toBe("/services");
    expect(discoveryGroupHref("MORE", "MUSCAT")).toBe("/services?region=MUSCAT");
  });

  it("a service card links to its own public detail page", () => {
    expect(serviceCardHref("svc-1")).toBe("/services/svc-1");
  });

  it("an Explore-Oman governorate enters the browse surface scoped to that region", () => {
    expect(governorateBrowseHref("MUSANDAM")).toBe("/services?region=MUSANDAM");
  });

  it("a hero governorate chip re-scopes the HOME; All Oman clears the scope", () => {
    expect(homeGovernorateHref("MUSCAT")).toBe("/?region=MUSCAT");
    expect(homeGovernorateHref(null)).toBe("/");
  });

  it("region values are URL-encoded (defensive — codes are enum-safe today)", () => {
    expect(discoveryGroupHref("TRANSPORT", "A B")).toBe("/services?group=TRANSPORT&region=A%20B");
  });
});

describe("home-nav — discoveryNavItems (the 'What are you looking for?' grid)", () => {
  it("returns exactly the six groups in canonical registry order, MORE last", () => {
    const keys = discoveryNavItems().map((i) => i.key);
    expect(keys).toEqual(["EXPERIENCES", "TOURIST_GUIDES", "TRANSPORT", "CAR_RENTAL", "MARINE_TRIPS", "MORE"]);
    expect(keys[keys.length - 1]).toBe("MORE");
  });

  it("each item carries its registry label/icon key and a region-threaded href", () => {
    const items = discoveryNavItems("DHOFAR");
    const experiences = items.find((i) => i.key === "EXPERIENCES")!;
    expect(experiences.labelKey).toBe("discoveryExperiences");
    expect(experiences.iconKey).toBe("compass");
    expect(experiences.href).toBe("/services?group=EXPERIENCES&region=DHOFAR");
    // MORE still drops the group filter even when region-scoped.
    expect(items.find((i) => i.key === "MORE")!.href).toBe("/services?region=DHOFAR");
  });
});

describe("home-nav — categorySlugsForGroup (registry authority, fail-closed)", () => {
  it("EXPERIENCES spans its three real slugs, excluding tourist-guides", () => {
    expect(categorySlugsForGroup("EXPERIENCES")).toEqual(["adventures", "local-experiences", "cultural-tours"]);
    expect(categorySlugsForGroup("EXPERIENCES")).not.toContain("tourist-guides");
  });

  it("TOURIST_GUIDES is its own group (a professional service, not an Experience)", () => {
    expect(categorySlugsForGroup("TOURIST_GUIDES")).toEqual(["tourist-guides"]);
  });

  it("MORE and unknown keys resolve to no slugs (never an unfiltered dump)", () => {
    expect(categorySlugsForGroup("MORE")).toEqual([]);
    expect(categorySlugsForGroup("NOPE")).toEqual([]);
  });
});
