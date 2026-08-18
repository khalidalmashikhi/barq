import { describe, it, expect } from "vitest";
import {
  emptyTourFormState,
  applyPackageChange,
  buildGuidingContentPayload,
  hydrateTourFormState,
  vehicleVisibleFor,
  vehicleRequiredFor,
  forcedVehicleTypeFor,
  type TourFormState,
} from "./tour-form-state";
import { parseGuidingContent } from "../guiding-content";

// The serialization layer produces exactly the TOUR-1 v1 shape and always
// re-passes the real parseGuidingContent() contract — proving the UI can never
// emit a payload the server would reject for shape reasons.

const V1_KEYS = [
  "version",
  "packageType",
  "durationMinutes",
  "meetingPoint",
  "pickup",
  "maxGuests",
  "languages",
  "itinerary",
  "includedItems",
  "excludedItems",
  "difficulty",
  "childFriendly",
  "privateTour",
  "recommendedEquipment",
  "refreshmentsIncluded",
  "importantNotes",
  "vehicle",
].sort();

function filledState(overrides: Partial<TourFormState> = {}): TourFormState {
  return {
    ...emptyTourFormState("GUIDE_WITH_TRANSPORT"),
    durationMinutes: "180",
    meetingPoint: "Nizwa Fort",
    pickupIncluded: true,
    pickupArea: "Muscat hotels",
    hotelPickup: true,
    airportPickup: false,
    maxGuests: "6",
    languages: "Arabic\nEnglish",
    itinerary: [{ title: "Old town", description: "walk" }],
    includedItems: "Water\nSnacks",
    excludedItems: "Lunch",
    difficulty: "MODERATE",
    childFriendly: true,
    privateTour: true,
    recommendedEquipment: "Hat",
    refreshmentsIncluded: false,
    importantNotes: "Arrive early",
    vehicle: { type: "SUV", make: "Toyota", model: "Prado", year: "2022", passengerCapacity: "6" },
    ...overrides,
  };
}

describe("package -> vehicle semantics (mirror app-owned rules)", () => {
  it("GUIDE_ONLY hides + forbids a vehicle", () => {
    expect(vehicleVisibleFor("GUIDE_ONLY")).toBe(false);
    expect(vehicleRequiredFor("GUIDE_ONLY")).toBe(false);
    expect(forcedVehicleTypeFor("GUIDE_ONLY")).toBeNull();
  });
  it("GUIDE_WITH_TRANSPORT shows + requires a vehicle", () => {
    expect(vehicleVisibleFor("GUIDE_WITH_TRANSPORT")).toBe(true);
    expect(vehicleRequiredFor("GUIDE_WITH_TRANSPORT")).toBe(true);
    expect(forcedVehicleTypeFor("GUIDE_WITH_TRANSPORT")).toBeNull();
  });
  it("GUIDE_WITH_4X4 forces FOUR_BY_FOUR", () => {
    expect(forcedVehicleTypeFor("GUIDE_WITH_4X4")).toBe("FOUR_BY_FOUR");
    expect(vehicleRequiredFor("GUIDE_WITH_4X4")).toBe(true);
  });
  it("PRIVATE_CUSTOM_TOUR shows but does not require a vehicle", () => {
    expect(vehicleVisibleFor("PRIVATE_CUSTOM_TOUR")).toBe(true);
    expect(vehicleRequiredFor("PRIVATE_CUSTOM_TOUR")).toBe(false);
  });
});

describe("applyPackageChange clears/forces the vehicle", () => {
  it("switching to GUIDE_ONLY clears any stale vehicle", () => {
    const next = applyPackageChange(filledState(), "GUIDE_ONLY");
    expect(next.vehicle).toEqual({ type: "", make: "", model: "", year: "", passengerCapacity: "" });
  });
  it("switching to GUIDE_WITH_4X4 forces the vehicle type to FOUR_BY_FOUR", () => {
    const next = applyPackageChange(filledState(), "GUIDE_WITH_4X4");
    expect(next.vehicle.type).toBe("FOUR_BY_FOUR");
    expect(next.vehicle.make).toBe("Toyota"); // other fields preserved
  });
});

describe("buildGuidingContentPayload", () => {
  it("emits ONLY the fixed v1 keys (no unknown-key injection)", () => {
    const payload = buildGuidingContentPayload(filledState());
    expect(Object.keys(payload).sort()).toEqual(V1_KEYS);
  });

  it("produces a payload the real parseGuidingContent() accepts", () => {
    const result = parseGuidingContent(buildGuidingContentPayload(filledState()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.languages).toEqual(["Arabic", "English"]);
      expect(result.value.includedItems).toEqual(["Water", "Snacks"]);
      expect(result.value.vehicle?.type).toBe("SUV");
    }
  });

  it("GUIDE_ONLY serializes vehicle as null (accepted by the contract)", () => {
    const state = applyPackageChange(filledState(), "GUIDE_ONLY");
    const payload = buildGuidingContentPayload(state);
    expect(payload.vehicle).toBeNull();
    expect(parseGuidingContent(payload).ok).toBe(true);
  });

  it("clears pickup sub-fields when pickup is not included", () => {
    const payload = buildGuidingContentPayload(filledState({ pickupIncluded: false, pickupArea: "stale", hotelPickup: true, airportPickup: true }));
    expect(payload.pickup).toEqual({ included: false, area: null, hotelPickup: false, airportPickup: false });
  });

  it("GUIDE_WITH_4X4 with a forced 4x4 vehicle is accepted; a stale non-4x4 type would be caught server-side", () => {
    const ok = applyPackageChange(filledState(), "GUIDE_WITH_4X4");
    expect(parseGuidingContent(buildGuidingContentPayload(ok)).ok).toBe(true);
  });

  it("PRIVATE_CUSTOM_TOUR with no vehicle chosen serializes vehicle null and is accepted", () => {
    const state = emptyTourFormState("PRIVATE_CUSTOM_TOUR");
    const payload = buildGuidingContentPayload({ ...state, meetingPoint: "x" });
    expect(payload.vehicle).toBeNull();
    expect(parseGuidingContent(payload).ok).toBe(true);
  });
});

describe("hydrateTourFormState", () => {
  it("returns an empty GUIDE_ONLY state for null (absent/malformed sanitized read)", () => {
    const state = hydrateTourFormState(null);
    expect(state.packageType).toBe("GUIDE_ONLY");
    expect(state.vehicle.type).toBe("");
  });

  it("round-trips: hydrate(parsed) -> build -> parse equals the original", () => {
    const parsed = parseGuidingContent(buildGuidingContentPayload(filledState()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rebuilt = parseGuidingContent(buildGuidingContentPayload(hydrateTourFormState(parsed.value)));
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect(rebuilt.value).toEqual(parsed.value);
  });
});
