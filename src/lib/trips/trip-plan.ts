import type { RegionCode } from "@/lib/regions";
import type { TripInput, TripInterest, TripMobility } from "./trip-input";

// 2026-10-17 — Trip planner, grounded foundation. PURE plan contract.
//
// GROUNDING RULE: every fact on a BARQ item (its id, name, region, duration, price options, date
// availability) is copied from a server-side TripCandidate read from BARQ's own published data —
// never produced by the planner or a model. Anything else is a GENERAL suggestion, rendered as such
// ("General trip suggestion", unverified), and carries no price, time, place or availability.
// Travel time / distance between stops is NOT known to BARQ (no coordinates) and is never estimated.

/** Lifecycle of a plan. SAVED / ARCHIVED need persistence (a later, separately-approved phase):
 *  no code path in this phase produces them. */
export const TRIP_PLAN_STATES = ["DRAFT_INPUT", "GENERATING", "READY", "PARTIALLY_AVAILABLE", "FAILED_RETRYABLE", "SAVED", "ARCHIVED"] as const;
export type TripPlanState = (typeof TRIP_PLAN_STATES)[number];

export const TRIP_PERIODS = ["morning", "afternoon", "evening"] as const;
export type TripPeriod = (typeof TRIP_PERIODS)[number];

/** A real, published BARQ service as the planner may use it — the SMALLEST dataset needed.
 *  Never: provider identity/contact, descriptions, documents, vehicles, registration data. */
export type TripCandidate = {
  serviceId: string;
  name: string;
  regionCode: RegionCode | null;
  categorySlug: string | null;
  durationMinutes: number | null;
  /** Active, BOOKABLE price options only (unit amount as a 2dp string). */
  prices: { amount: string; currency: string; pricingUnit: string }[];
  /** The service is booked against dated slots. */
  requiresSlot: boolean;
  /** Oman date key → open slots that day (Oman start hour, seats left). */
  slotsByDate: Record<string, { startHour: number; remainingSeats: number }[]>;
};

export type TripItemAvailability =
  /** A dated slot with enough seats exists on the plan day. */
  | "AVAILABLE_ON_DATE"
  /** The service needs no dated slot (bookable without a time). */
  | "SLOTLESS"
  /** No trip dates were given — date availability not checked yet. */
  | "DATE_NOT_CHECKED"
  /** The service needs a slot and none with enough seats exists on the plan day. */
  | "NO_SLOT_ON_DATE";

export type TripMoney = { min: string; max: string; currency: string };

export type TripBarqItem = {
  kind: "BARQ_SERVICE";
  serviceId: string;
  name: string;
  durationMinutes: number | null;
  availability: TripItemAvailability;
  /** Estimated cost for the party from the service's own price options; null when not computable. */
  estimatedCost: TripMoney | null;
};

export type TripGeneralItem = {
  kind: "GENERAL_SUGGESTION";
  /** A fixed `trips` message key — never free text, never a named place. */
  suggestionKey: TripSuggestionKey;
};

export type TripItem = TripBarqItem | TripGeneralItem;

export type TripDay = {
  dayNumber: number;
  /** Oman date key, or null when no dates were given. */
  date: string | null;
  periods: Record<TripPeriod, TripItem[]>;
  /** Fixed `trips` message keys of practical, general notes. */
  noteKeys: TripNoteKey[];
  /** Sum over the day's BARQ items with a computable cost; `partial` when some cost is unknown. */
  estimatedCost: (TripMoney & { partial: boolean }) | null;
};

export type TripPlan = {
  version: 1;
  /** Signature of the input this plan was made from (stale-response guard). */
  inputSignature: string;
  state: Extract<TripPlanState, "READY" | "PARTIALLY_AVAILABLE">;
  regionCode: RegionCode;
  days: TripDay[];
  /** Unused real services in the region the customer may swap in (replace an activity). */
  alternatives: TripBarqItemOption[];
  /** Always false: BARQ has no distance / travel-time data. */
  travelTimeAvailable: false;
  /** How the plan was produced. This phase produces DETERMINISTIC only; MODEL_VALIDATED is the
   *  shape a future, separately-approved model path would carry after deterministic validation. */
  source: "DETERMINISTIC" | "MODEL_VALIDATED";
};

/** A replacement option (no date — its availability is resolved for the target day on swap). */
export type TripBarqItemOption = { serviceId: string; name: string; durationMinutes: number | null };

export const TRIP_SUGGESTION_KEYS = [
  "suggestionFreeTime",
  "suggestionRest",
  "suggestionScenicStop",
  "suggestionBeachTime",
  "suggestionHeritageWalk",
  "suggestionLocalFood",
  "suggestionMarket",
  "suggestionFamilyTime",
  "suggestionEveningStroll",
] as const;
export type TripSuggestionKey = (typeof TRIP_SUGGESTION_KEYS)[number];

export const TRIP_NOTE_KEYS = ["noteSunAndWater", "noteFamilySuitability", "noteAccessibility", "noteBookAhead", "noteCheckDetails"] as const;
export type TripNoteKey = (typeof TRIP_NOTE_KEYS)[number];

/** Which REAL category slugs (ADR-0016 taxonomy) may serve an interest. An interest with no
 *  category is honest: it only shapes general suggestions, never a claimed match. */
export const INTEREST_CATEGORY_SLUGS: Record<TripInterest, readonly string[]> = {
  adventure: ["adventures"],
  heritage: ["cultural-tours", "local-experiences"],
  beaches: ["marine-trips"],
  nature: ["adventures", "tourist-guides"],
  mountains: ["adventures", "tourist-guides"],
  family: [],
  food: [],
  shopping: [],
};

/** Mobility choice → category slugs that serve it (rental → cars; guided → guides). */
export const MOBILITY_CATEGORY_SLUGS: Record<TripMobility, readonly string[]> = {
  own: [],
  rental: ["cars"],
  guided: ["tourist-guides"],
};

/** General suggestion keys an interest may add (no place names, no claims). */
export const INTEREST_SUGGESTIONS: Record<TripInterest, TripSuggestionKey> = {
  nature: "suggestionScenicStop",
  mountains: "suggestionScenicStop",
  beaches: "suggestionBeachTime",
  heritage: "suggestionHeritageWalk",
  adventure: "suggestionFreeTime",
  family: "suggestionFamilyTime",
  food: "suggestionLocalFood",
  shopping: "suggestionMarket",
};

export type { TripInput };
