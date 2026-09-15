import { parseOmanDateKey } from "@/lib/date/oman-time";

// Phase 3C Slice C2a — the SHARED, normalized vehicle-day calendar CONTRACT (types +
// constants + pure window validation) that both future offering families (rental and
// guided) will resolve into. C2a defines the shape ONLY: there is NO resolver, NO Prisma
// adapter, NO DTO serialization, and NO API route here — those are C2c/C2d.
//
// Invariants this contract encodes:
//   • A physical vehicle's inventory is BINARY (available / unavailable) for an overlapping
//     Oman-day window — there is deliberately NO `remainingCapacity` for one physical vehicle.
//   • `effectivePassengerCapacity` is capacity VALIDATION metadata (min of the vehicle's
//     verified bookable capacity and any offering override), NEVER inventory and NEVER a price
//     multiplier.
//   • `dailyPrice` is non-null ONLY when the date is actually customer-bookable; a day that is
//     unavailable for any reason carries a null price and a specific `unavailableReason`.
//   • Start-time rows are OPERATIONAL pickup/handover choices; they do not change the daily
//     billing quantity, and the ABSENCE of an OPEN start time does not, by itself, make an
//     explicitly OPEN day unavailable (a future booking may use a provider/service default
//     pickup arrangement) — hence there is NO `NO_OPEN_START_TIME` reason.
//   • Guided customer availability stays FAIL-CLOSED until guide-reservation/overlap is
//     authoritative (C3/E): the guided calendar is not exposed to customers yet, and the shared
//     `UnavailableReason` includes `GUIDE_RESERVATION_NOT_READY` for that gated state.

export type OfferingKind = "VEHICLE_RENTAL" | "GUIDED_TOUR_VEHICLE";

/** Explicit provider day record state; `NONE` means no day row exists for that date. */
export type OfferingDayState = "OPEN" | "BLOCKED" | "NONE";

/** Derived, customer-facing availability of a single date. */
export type OfferingDayAvailability = "AVAILABLE" | "UNAVAILABLE" | "PAST";

/** Why a date is not `AVAILABLE`. Stable taxonomy (fail-closed). */
export type UnavailableReason =
  | "PAST" // the Oman calendar date is before today
  | "NO_OPEN_DAY" // no explicit day row (dayState NONE) — absence is never availability
  | "BLOCKED" // an explicit provider close
  | "NO_PRICE" // no authoritative daily price resolves
  | "VEHICLE_CONFLICT" // the physical vehicle is already committed for the day window
  | "OFFERING_NOT_BOOKABLE" // offering unpublished/suspended/archived, non-compliant vertical, or vehicle not selectable
  | "GUIDE_RESERVATION_NOT_READY"; // guided only: guide-overlap enforcement is not authoritative yet (C3/E)

/** The single physical vehicle a calendar is for. Binary availability; capacity is metadata. */
export type OfferingCalendarVehicle = {
  id: string;
  label: string;
  effectivePassengerCapacity: number;
};

export type OfferingCalendarStartTime = {
  startTimeId: string;
  /** Oman-local "HH:mm". */
  startTime: string;
  state: "OPEN";
};

export type OfferingCalendarDay = {
  dateKey: string;
  dayState: OfferingDayState;
  availability: OfferingDayAvailability;
  unavailableReason?: UnavailableReason;
  /** Authoritative daily price; non-null ONLY when the day is customer-bookable. */
  dailyPrice: { amount: string; currency: string } | null;
  startTimes: OfferingCalendarStartTime[];
};

export type OfferingCalendar = {
  offeringKind: OfferingKind;
  offeringId: string;
  vehicle: OfferingCalendarVehicle;
  currency: string;
  /** Minimum price over AVAILABLE days in the returned window; null if none is available. */
  lowestAvailableDailyRate: { amount: string; currency: string } | null;
  days: OfferingCalendarDay[];
};

// --- Calendar window contract (locked Gate 2 decisions) ---------------------------------
// Maximum inclusive window a future calendar read may request.
export const MAX_CALENDAR_WINDOW_DAYS = 62;
// Default inclusive window (today through today+31 = 32 dates) when from/to are omitted.
export const DEFAULT_CALENDAR_WINDOW_DAYS = 32;

const MS_PER_DAY = 86_400_000;

/**
 * The number of INCLUSIVE Oman calendar dates in [fromKey, toKey]. Pure: parses + validates
 * both keys as real dates and computes the day span from their UTC-midnight instants (a
 * zone-free calendar difference — no offset applied). Returns null for an invalid key or a
 * reversed range (from > to). A single-day window (from == to) returns 1.
 */
export function calendarWindowInclusiveDays(fromKey: string, toKey: string): number | null {
  const from = parseOmanDateKey(fromKey);
  const to = parseOmanDateKey(toKey);
  if (from === null || to === null) return null;
  const f = from.split("-").map(Number);
  const t = to.split("-").map(Number);
  const fromMs = Date.UTC(f[0]!, f[1]! - 1, f[2]!);
  const toMs = Date.UTC(t[0]!, t[1]! - 1, t[2]!);
  if (toMs < fromMs) return null;
  return Math.round((toMs - fromMs) / MS_PER_DAY) + 1;
}

/** Whether [fromKey, toKey] is a valid window within the maximum (≤ MAX_CALENDAR_WINDOW_DAYS). */
export function isWithinMaxCalendarWindow(fromKey: string, toKey: string): boolean {
  const days = calendarWindowInclusiveDays(fromKey, toKey);
  return days !== null && days <= MAX_CALENDAR_WINDOW_DAYS;
}
