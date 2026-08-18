import { describe, it, expect } from "vitest";
import { resolveGuidingContentWrite } from "./resolve-guiding-content-write";

// The shared write-boundary resolver: supplied payload -> must be eligible -> must
// parse. Absent/blank -> none. Rejection preferred over silent dropping.

const TG = "cat-tourist-guides";

function validPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    packageType: "GUIDE_ONLY",
    durationMinutes: 120,
    meetingPoint: "Nizwa Fort",
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: 4,
    languages: ["Arabic"],
    itinerary: [],
    includedItems: [],
    excludedItems: [],
    difficulty: null,
    childFriendly: null,
    privateTour: null,
    recommendedEquipment: [],
    refreshmentsIncluded: null,
    importantNotes: null,
    vehicle: null,
    ...overrides,
  });
}

describe("resolveGuidingContentWrite", () => {
  it("returns none for an absent/blank field", () => {
    expect(resolveGuidingContentWrite({ raw: null, providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG }).kind).toBe("none");
    expect(resolveGuidingContentWrite({ raw: "   ", providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG }).kind).toBe("none");
  });

  it("returns set with the normalized value for an eligible + valid payload", () => {
    const result = resolveGuidingContentWrite({ raw: validPayload(), providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG });
    expect(result.kind).toBe("set");
    if (result.kind === "set") expect(result.value.packageType).toBe("GUIDE_ONLY");
  });

  it("rejects (NOT_ELIGIBLE) when a payload is supplied for a COMPANY provider", () => {
    const result = resolveGuidingContentWrite({ raw: validPayload(), providerType: "COMPANY", categoryId: TG, touristGuideCategoryId: TG });
    expect(result).toEqual({ kind: "error", error: "TOUR_TEMPLATE_NOT_ELIGIBLE" });
  });

  it("rejects (NOT_ELIGIBLE) when a payload is supplied for a non-tourist-guide category", () => {
    const result = resolveGuidingContentWrite({ raw: validPayload(), providerType: "INDIVIDUAL", categoryId: "cat-other", touristGuideCategoryId: TG });
    expect(result).toEqual({ kind: "error", error: "TOUR_TEMPLATE_NOT_ELIGIBLE" });
  });

  it("rejects (INVALID) eligible-but-malformed JSON or contract failures", () => {
    expect(resolveGuidingContentWrite({ raw: "{not json", providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG })).toEqual({
      kind: "error",
      error: "TOUR_TEMPLATE_INVALID",
    });
    // eligible, JSON-valid, but breaks the contract (GUIDE_ONLY must not carry a vehicle)
    const bad = validPayload({ vehicle: { type: "SUV", make: null, model: null, year: null, passengerCapacity: null } });
    expect(resolveGuidingContentWrite({ raw: bad, providerType: "INDIVIDUAL", categoryId: TG, touristGuideCategoryId: TG })).toEqual({
      kind: "error",
      error: "TOUR_TEMPLATE_INVALID",
    });
  });

  it("eligibility is checked BEFORE parsing — an ineligible malformed payload reports NOT_ELIGIBLE", () => {
    expect(resolveGuidingContentWrite({ raw: "{not json", providerType: "COMPANY", categoryId: TG, touristGuideCategoryId: TG })).toEqual({
      kind: "error",
      error: "TOUR_TEMPLATE_NOT_ELIGIBLE",
    });
  });
});
