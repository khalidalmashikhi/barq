// Smart Tour-Guide Template — app-owned FIELD REGISTRY.
//
// Pure. The application owns which tour fields exist; a TourTemplateFieldRule row
// whose `key` is NOT in this allowlist is IGNORED (fail-closed) — an unknown DB
// key can never conjure a form field. Admin may only tune the SOFT presentation
// (visible / required / label / helpText / sortOrder) of a key that appears here.
//
// SECURITY BOUNDARY: none of these keys is `packageType` or `vehicleType`. The
// hard package→vehicle invariants (a transport package requires a vehicle;
// GUIDE_WITH_4X4 requires FOUR_BY_FOUR) live ONLY in the guidingContent contract
// and are never expressed as a field rule — so an admin toggling any rule here
// can never relax a server invariant.

export const TOUR_FIELD_KEYS = [
  "duration",
  "meetingPoint",
  "pickupIncluded",
  "pickupArea",
  "maxGuests",
  "languages",
  "itinerary",
  "includedItems",
  "excludedItems",
  "difficulty",
  "childFriendly",
  "privateTour",
  "hotelPickup",
  "airportPickup",
  "recommendedEquipment",
  "refreshmentsIncluded",
  "importantNotes",
  "vehicleMake",
  "vehicleModel",
  "vehicleCapacity",
  "vehicleYear",
] as const;

export type TourFieldKey = (typeof TOUR_FIELD_KEYS)[number];

const FIELD_KEY_SET: ReadonlySet<string> = new Set(TOUR_FIELD_KEYS);

export function isTourFieldKey(value: unknown): value is TourFieldKey {
  return typeof value === "string" && FIELD_KEY_SET.has(value);
}

// Default field-rule presentation — bootstrap seed + fail-closed fallback.
// Mirrors the ProviderVerificationRequirement precedent: a NEW rule defaults to
// visible + OPTIONAL, so simply seeding a rule can never make a field mandatory
// by surprise. Admin flips required/visible later. `sortOrder` follows registry
// order. label/helpText default to null here — the form falls back to i18n keys
// until an admin sets an override.
export type TourFieldRuleDefault = {
  key: TourFieldKey;
  visible: boolean;
  required: boolean;
  sortOrder: number;
};

export const TOUR_FIELD_RULE_DEFAULTS: readonly TourFieldRuleDefault[] = TOUR_FIELD_KEYS.map((key, index) => ({
  key,
  visible: true,
  required: false,
  sortOrder: index,
}));
