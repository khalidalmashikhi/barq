import { calculateBookingTotal } from "@/lib/booking/pricing/calculate-booking-total";
import { tripDateKeys, tripInputSignature, type TripInput } from "./trip-input";
import { dayCost } from "./trip-plan-editing";
import {
  INTEREST_CATEGORY_SLUGS,
  INTEREST_SUGGESTIONS,
  MOBILITY_CATEGORY_SLUGS,
  TRIP_PERIODS,
  type TripBarqItem,
  type TripCandidate,
  type TripDay,
  type TripItem,
  type TripItemAvailability,
  type TripMoney,
  type TripNoteKey,
  type TripPeriod,
  type TripPlan,
  type TripSuggestionKey,
} from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation. PURE, DETERMINISTIC planner: the same input and
// candidates always give the same plan (a reload never "re-rolls"; a double tap cannot produce two
// different plans). It only ever places REAL candidates (read server-side from published BARQ
// data); every BARQ fact is copied from the candidate. Empty periods get a fixed general
// suggestion key. Nothing here touches the network, the database or a model.
//
//   pace      relaxed 1 · balanced 2 · intensive 3 BARQ services per day (at most one per period)
//   period    a dated slot decides it (Oman start hour: < 12 morning, < 17 afternoon, else evening);
//             otherwise the first free period
//   eligible  a service that needs a slot is used on a dated day ONLY if a slot with enough seats
//             exists that day; each service at most once per plan
//   ranking   interest category match, then mobility match, then "has dates", then stable id order;
//             `variant` rotates ties (regenerate) — still deterministic

export const PACE_SERVICES_PER_DAY = { relaxed: 1, balanced: 2, intensive: 3 } as const;
const OUTDOOR_INTERESTS = new Set(["nature", "beaches", "mountains", "adventure"]);
export const TRIP_MAX_ALTERNATIVES = 8;

export function partySize(input: Pick<TripInput, "adults" | "children">): number {
  return input.adults + input.children;
}

/** Oman start hour → period. */
export function periodForHour(hour: number): TripPeriod {
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** Estimated cost for the party from the candidate's own bookable price options (the same
 *  calculator the booking flow uses). Null when no option is computable or currencies differ. */
export function estimateItemCost(c: TripCandidate, party: number): TripMoney | null {
  const totals = c.prices
    .map((p) => calculateBookingTotal({ unitAmount: p.amount, currency: p.currency, pricingUnit: p.pricingUnit, bookingQuantity: party }))
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.value);
  if (totals.length === 0) return null;
  const currency = totals[0]!.currency;
  if (totals.some((t) => t.currency !== currency)) return null;
  const sorted = [...totals].sort((a, b) => a.total.comparedTo(b.total));
  return { min: sorted[0]!.total.toFixed(2), max: sorted[sorted.length - 1]!.total.toFixed(2), currency };
}

/** Date availability of a candidate on a plan day, for the party. */
export function availabilityOn(c: TripCandidate, date: string | null, party: number): TripItemAvailability {
  if (!c.requiresSlot) return "SLOTLESS";
  if (date === null) return "DATE_NOT_CHECKED";
  return (c.slotsByDate[date] ?? []).some((s) => s.remainingSeats >= party) ? "AVAILABLE_ON_DATE" : "NO_SLOT_ON_DATE";
}

/** The ONE way a BARQ item is built — from the candidate only (planner AND model-output validator). */
export function toBarqItem(c: TripCandidate, date: string | null, party: number): TripBarqItem {
  return { kind: "BARQ_SERVICE", serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, availability: availabilityOn(c, date, party), estimatedCost: estimateItemCost(c, party) };
}

/** The period a candidate prefers on a date (its first fitting slot), or null (any period). */
function preferredPeriod(c: TripCandidate, date: string | null, party: number): TripPeriod | null {
  if (!c.requiresSlot || date === null) return null;
  const slot = (c.slotsByDate[date] ?? []).filter((s) => s.remainingSeats >= party).sort((a, b) => a.startHour - b.startHour)[0];
  return slot ? periodForHour(slot.startHour) : null;
}

function score(c: TripCandidate, input: TripInput): number {
  const slug = c.categorySlug ?? "";
  let s = 0;
  if (input.interests.some((i) => INTEREST_CATEGORY_SLUGS[i].includes(slug))) s += 3;
  if (MOBILITY_CATEGORY_SLUGS[input.mobility].includes(slug)) s += 2;
  if (Object.keys(c.slotsByDate).length > 0 || !c.requiresSlot) s += 1;
  return s;
}

/** Candidates within the per-person budget (when one is given), ranked; `variant` rotates ties. */
export function rankCandidates(input: TripInput, candidates: readonly TripCandidate[], variant = 0): TripCandidate[] {
  const party = partySize(input);
  const affordable = candidates.filter((c) => {
    if (input.budgetPerPerson === null) return true;
    const cost = estimateItemCost(c, party);
    return cost === null || Number(cost.min) / party <= input.budgetPerPerson;
  });
  const byId = [...affordable].sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0));
  const n = byId.length;
  const rotated = n === 0 ? byId : [...byId.slice(variant % n), ...byId.slice(0, variant % n)];
  return rotated.map((c, i) => ({ c, i, s: score(c, input) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

function generalKeyFor(input: TripInput, dayIndex: number, period: TripPeriod): TripSuggestionKey {
  if (input.pace === "relaxed" && period === "afternoon") return "suggestionRest";
  if (period === "evening") return input.interests.includes("food") ? "suggestionLocalFood" : "suggestionEveningStroll";
  const pool = input.interests.map((i) => INTEREST_SUGGESTIONS[i]);
  if (pool.length === 0) return "suggestionFreeTime";
  return pool[(dayIndex * 2 + TRIP_PERIODS.indexOf(period)) % pool.length]!;
}

export function dayNotes(input: TripInput, items: readonly TripItem[]): TripNoteKey[] {
  const notes: TripNoteKey[] = [];
  if (input.interests.some((i) => OUTDOOR_INTERESTS.has(i))) notes.push("noteSunAndWater");
  if (input.children > 0 || input.needs.family) notes.push("noteFamilySuitability");
  if (input.needs.accessibility) notes.push("noteAccessibility");
  const barq = items.filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE");
  if (barq.some((i) => i.availability === "DATE_NOT_CHECKED")) notes.push("noteBookAhead");
  if (barq.length > 0) notes.push("noteCheckDetails");
  return notes;
}

function emptyPeriods(): Record<TripPeriod, TripItem[]> {
  return { morning: [], afternoon: [], evening: [] };
}

/** Build ONE day (also used to regenerate a single day, excluding services used elsewhere). */
export function buildTripDay(input: TripInput, candidates: readonly TripCandidate[], dayNumber: number, opts: { excludeServiceIds?: readonly string[]; variant?: number } = {}): TripDay {
  const party = partySize(input);
  const date = tripDateKeys(input)[dayNumber - 1] ?? null;
  const excluded = new Set(opts.excludeServiceIds ?? []);
  const periods = emptyPeriods();
  const target = PACE_SERVICES_PER_DAY[input.pace];
  let placed = 0;
  // A slot CONFIRMED on this very date outranks an equally scored slotless option (a real, dated
  // fact is the strongest grounding); an interest match still dominates. Stable for ties.
  const ranked = rankCandidates(input, candidates, opts.variant ?? 0)
    .map((c, i) => ({ c, i, s: score(c, input) + (availabilityOn(c, date, party) === "AVAILABLE_ON_DATE" ? 1 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
  for (const c of ranked) {
    if (placed >= target) break;
    if (excluded.has(c.serviceId)) continue;
    if (availabilityOn(c, date, party) === "NO_SLOT_ON_DATE") continue; // never offered on a day it cannot be booked
    const preferred = preferredPeriod(c, date, party);
    const period = preferred ?? TRIP_PERIODS.find((p) => periods[p].length === 0);
    if (!period || periods[period].length > 0) continue;
    periods[period].push(toBarqItem(c, date, party));
    excluded.add(c.serviceId);
    placed += 1;
  }
  TRIP_PERIODS.forEach((p) => {
    if (periods[p].length === 0) periods[p].push({ kind: "GENERAL_SUGGESTION", suggestionKey: generalKeyFor(input, dayNumber - 1, p) });
  });
  const items = TRIP_PERIODS.flatMap((p) => periods[p]);
  return { dayNumber, date, periods, noteKeys: dayNotes(input, items), estimatedCost: dayCost(items) };
}

export function usedServiceIds(days: readonly TripDay[], exceptDay?: number): string[] {
  return days
    .filter((d) => d.dayNumber !== exceptDay)
    .flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p]))
    .filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE")
    .map((i) => i.serviceId);
}

/** READY when every day holds at least one real BARQ service; otherwise PARTIALLY_AVAILABLE. */
export function planState(days: readonly TripDay[]): TripPlan["state"] {
  return days.every((d) => TRIP_PERIODS.some((p) => d.periods[p].some((i) => i.kind === "BARQ_SERVICE"))) ? "READY" : "PARTIALLY_AVAILABLE";
}

export function planAlternatives(input: TripInput, candidates: readonly TripCandidate[], days: readonly TripDay[]): TripPlan["alternatives"] {
  const used = new Set(usedServiceIds(days));
  return rankCandidates(input, candidates)
    .filter((c) => !used.has(c.serviceId))
    .slice(0, TRIP_MAX_ALTERNATIVES)
    .map((c) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes }));
}

/** The whole plan, day by day; no service repeats across days. */
export function buildTripPlan(input: TripInput, candidates: readonly TripCandidate[], opts: { variant?: number } = {}): TripPlan {
  const days: TripDay[] = [];
  for (let n = 1; n <= input.days; n++) days.push(buildTripDay(input, candidates, n, { excludeServiceIds: usedServiceIds(days), variant: opts.variant }));
  return {
    version: 1,
    inputSignature: tripInputSignature(input),
    state: planState(days),
    regionCode: input.regionCode,
    days,
    alternatives: planAlternatives(input, candidates, days),
    travelTimeAvailable: false,
    source: "DETERMINISTIC",
  };
}
