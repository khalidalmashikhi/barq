import { describe, it, expect } from "vitest";
import { parseGuidingContent } from "./guiding-content";
import { TOUR_FIELD_KEYS } from "./field-registry";

// Smart Tour-Guide Template — the strict guidingContent contract is the security
// boundary between untrusted provider/native input and the Experience.guiding-
// Content Json column. These tests pin: strictness (no unknown keys), version,
// package->vehicle invariants, bounds, plain-text/no-HTML, and normalization.

type Json = Record<string, unknown>;

function validBase(overrides: Json = {}): Json {
  return {
    version: 1,
    packageType: "GUIDE_ONLY",
    durationMinutes: 180,
    meetingPoint: "Muscat Grand Mall entrance",
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: 6,
    languages: ["Arabic", "English"],
    itinerary: [{ title: "Old Muscat", description: null }],
    includedItems: ["Water"],
    excludedItems: ["Lunch"],
    difficulty: "EASY",
    childFriendly: true,
    privateTour: true,
    recommendedEquipment: ["Hat"],
    refreshmentsIncluded: false,
    importantNotes: null,
    vehicle: null,
    ...overrides,
  };
}

const VEHICLE = { type: "SUV", make: "Toyota", model: "Land Cruiser", year: 2022, passengerCapacity: 6 };

describe("parseGuidingContent — shape & strictness", () => {
  it("accepts a valid GUIDE_ONLY payload and returns the normalized value", () => {
    const result = parseGuidingContent(validBase());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.packageType).toBe("GUIDE_ONLY");
  });

  it("REJECTS any unknown top-level key (strict — no arbitrary JSON)", () => {
    const result = parseGuidingContent(validBase({ somethingExtra: "x" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong version literal", () => {
    expect(parseGuidingContent(validBase({ version: 2 })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ version: "1" })).ok).toBe(false);
  });

  it("rejects an unknown packageType", () => {
    expect(parseGuidingContent(validBase({ packageType: "MYSTERY_TOUR" })).ok).toBe(false);
  });
});

describe("parseGuidingContent — package -> vehicle invariants (app-owned)", () => {
  it("GUIDE_ONLY must NOT include vehicle details", () => {
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_ONLY", vehicle: VEHICLE })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_ONLY", vehicle: null })).ok).toBe(true);
  });

  it("GUIDE_WITH_TRANSPORT REQUIRES a vehicle", () => {
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_TRANSPORT", vehicle: null })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_TRANSPORT", vehicle: VEHICLE })).ok).toBe(true);
  });

  it("GUIDE_WITH_4X4 requires a vehicle whose type is FOUR_BY_FOUR", () => {
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_4X4", vehicle: null })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_4X4", vehicle: { ...VEHICLE, type: "SUV" } })).ok).toBe(false);
    expect(
      parseGuidingContent(validBase({ packageType: "GUIDE_WITH_4X4", vehicle: { ...VEHICLE, type: "FOUR_BY_FOUR" } })).ok
    ).toBe(true);
  });

  it("PRIVATE_CUSTOM_TOUR allows vehicle present OR absent, but never bypasses other validation", () => {
    expect(parseGuidingContent(validBase({ packageType: "PRIVATE_CUSTOM_TOUR", vehicle: null })).ok).toBe(true);
    expect(parseGuidingContent(validBase({ packageType: "PRIVATE_CUSTOM_TOUR", vehicle: VEHICLE })).ok).toBe(true);
    // still strict: an unknown key is rejected even for the custom package
    expect(parseGuidingContent(validBase({ packageType: "PRIVATE_CUSTOM_TOUR", vehicle: null, hack: 1 })).ok).toBe(false);
  });

  it("a hard package invariant is enforced by the CONTRACT and cannot be a field-rule key (so DB config can never relax it)", () => {
    // The contract rejects a 4x4 package without a 4x4 vehicle regardless of any
    // admin config; and neither 'vehicle' nor 'vehicleType' is an admin-tunable
    // field key — the requirement is app-owned, not presentation config.
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_4X4", vehicle: null })).ok).toBe(false);
    expect(TOUR_FIELD_KEYS as readonly string[]).not.toContain("vehicleType");
    expect(TOUR_FIELD_KEYS as readonly string[]).not.toContain("vehicle");
  });
});

describe("parseGuidingContent — private/sensitive data cannot enter", () => {
  it("rejects a vehicle carrying a registration number (strict nested object)", () => {
    const vehicle = { ...VEHICLE, registrationNumber: "OM-12345" };
    expect(parseGuidingContent(validBase({ packageType: "GUIDE_WITH_TRANSPORT", vehicle })).ok).toBe(false);
  });

  it("rejects top-level private fields (objectKey / phone / documentUrl)", () => {
    expect(parseGuidingContent(validBase({ objectKey: "media/x.jpg" })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ phone: "+96890000000" })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ documentUrl: "https://x/doc.pdf" })).ok).toBe(false);
  });
});

describe("parseGuidingContent — bounds, plain text, normalization", () => {
  it("enforces numeric bounds", () => {
    expect(parseGuidingContent(validBase({ maxGuests: 0 })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ maxGuests: 5000 })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ durationMinutes: 0 })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ maxGuests: 6 })).ok).toBe(true);
  });

  it("enforces list size bounds", () => {
    expect(parseGuidingContent(validBase({ languages: Array.from({ length: 21 }, (_, i) => `L${i}`) })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ includedItems: Array.from({ length: 51 }, (_, i) => `I${i}`) })).ok).toBe(false);
  });

  it("rejects HTML/markup in text fields", () => {
    expect(parseGuidingContent(validBase({ meetingPoint: "<script>alert(1)</script>" })).ok).toBe(false);
    expect(parseGuidingContent(validBase({ importantNotes: "<b>note</b>" })).ok).toBe(false);
  });

  it("rejects disallowed control characters in text fields", () => {
    expect(parseGuidingContent(validBase({ meetingPoint: `Meet${String.fromCharCode(0)}here` })).ok).toBe(false);
  });

  it("allows newlines/tabs in text (multi-line notes)", () => {
    expect(parseGuidingContent(validBase({ importantNotes: "Line one\nLine two\tindented" })).ok).toBe(true);
  });

  it("normalizes blank nullable text to null and trims", () => {
    const result = parseGuidingContent(validBase({ meetingPoint: "   ", importantNotes: "  keep me  " }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.meetingPoint).toBeNull();
      expect(result.value.importantNotes).toBe("keep me");
    }
  });

  it("rejects an over-long string", () => {
    expect(parseGuidingContent(validBase({ meetingPoint: "x".repeat(501) })).ok).toBe(false);
  });
});
