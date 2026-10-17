import { z } from "zod";
import { tripDateKeys, tripInputSignature, type TripInput } from "./trip-input";
import { TRIP_PERIODS, TRIP_SUGGESTION_KEYS, type TripCandidate, type TripDay, type TripItem, type TripPeriod, type TripPlan } from "./trip-plan";
import { availabilityOn, dayNotes, partySize, planAlternatives, planState, toBarqItem } from "./trip-planner";
import { dayCost } from "./trip-plan-editing";

// 2026-10-17 — Trip planner, grounded foundation. PURE contract for a FUTURE model-assisted plan
// (no model is called in this phase — see trip-planner-model.ts). It fixes, before any provider is
// approved, the only shape a model may influence and how its answer is checked:
//
//   REQUEST (smallest dataset): trip length, pace, interests, party COUNTS, mobility, needs flags,
//     day dates, and anonymous options `{ ref, category, durationMinutes, availableDates }`.
//     NEVER: service names, prices, provider identity or contact, descriptions, documents,
//     vehicles, registration data, the customer's identity — nothing a model could leak or invent.
//   RESPONSE (strict): per day, per period, a short list of `{ ref }` (one of the options) or
//     `{ suggestion }` (one fixed general-suggestion key). No free text, no prices, no times.
//   VALIDATION (deterministic, fail-closed): malformed → rejected; wrong day count → rejected;
//     unknown ref / repeated service / not bookable on that day → dropped; then every BARQ fact is
//     REHYDRATED from the server-side candidate exactly as the deterministic planner does it.

export type TripModelOption = { ref: string; category: string | null; durationMinutes: number | null; availableDates: string[]; needsDate: boolean };
export type TripModelRequest = {
  days: number;
  dates: (string | null)[];
  pace: TripInput["pace"];
  interests: TripInput["interests"];
  party: { adults: number; children: number };
  mobility: TripInput["mobility"];
  needs: TripInput["needs"];
  options: TripModelOption[];
};

/** Build the minimal model request + the server-side ref → serviceId map (never sent). */
export function buildTripModelRequest(input: TripInput, candidates: readonly TripCandidate[]): { request: TripModelRequest; refs: Map<string, TripCandidate> } {
  const refs = new Map<string, TripCandidate>();
  const options = candidates.map((c, i) => {
    const ref = `s${i + 1}`;
    refs.set(ref, c);
    return { ref, category: c.categorySlug, durationMinutes: c.durationMinutes, availableDates: Object.keys(c.slotsByDate).sort(), needsDate: c.requiresSlot };
  });
  return {
    request: { days: input.days, dates: tripDateKeys(input), pace: input.pace, interests: input.interests, party: { adults: input.adults, children: input.children }, mobility: input.mobility, needs: input.needs, options },
    refs,
  };
}

const modelItem = z.union([z.object({ ref: z.string().regex(/^s\d{1,3}$/) }).strict(), z.object({ suggestion: z.enum(TRIP_SUGGESTION_KEYS) }).strict()]);
const modelDay = z
  .object({
    dayNumber: z.number().int().min(1).max(7),
    morning: z.array(modelItem).max(2),
    afternoon: z.array(modelItem).max(2),
    evening: z.array(modelItem).max(2),
  })
  .strict();
export const tripModelOutputSchema = z.object({ days: z.array(modelDay).min(1).max(7) }).strict();

export type TripModelValidation = { ok: true; plan: TripPlan; dropped: number } | { ok: false; reason: "MALFORMED" | "WRONG_DAY_COUNT" };

/** Check a model answer against the request it was given; fail closed, rehydrate facts from BARQ. */
export function validateTripModelOutput(raw: unknown, input: TripInput, candidates: readonly TripCandidate[], refs: ReadonlyMap<string, TripCandidate>): TripModelValidation {
  const parsed = tripModelOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "MALFORMED" };
  const byNumber = new Map(parsed.data.days.map((d) => [d.dayNumber, d]));
  if (parsed.data.days.length !== input.days || byNumber.size !== input.days || [...byNumber.keys()].some((n) => n > input.days)) return { ok: false, reason: "WRONG_DAY_COUNT" };
  const party = partySize(input);
  const dates = tripDateKeys(input);
  const used = new Set<string>();
  let dropped = 0;
  const days: TripDay[] = [];
  for (let n = 1; n <= input.days; n++) {
    const d = byNumber.get(n)!;
    const date = dates[n - 1] ?? null;
    const periods = { morning: [], afternoon: [], evening: [] } as Record<TripPeriod, TripItem[]>;
    for (const p of TRIP_PERIODS) {
      for (const it of d[p]) {
        if ("suggestion" in it) {
          periods[p].push({ kind: "GENERAL_SUGGESTION", suggestionKey: it.suggestion });
          continue;
        }
        const c = refs.get(it.ref);
        if (!c || used.has(c.serviceId) || availabilityOn(c, date, party) === "NO_SLOT_ON_DATE") {
          dropped += 1;
          continue;
        }
        used.add(c.serviceId);
        periods[p].push(toBarqItem(c, date, party));
      }
      if (periods[p].length === 0) periods[p].push({ kind: "GENERAL_SUGGESTION", suggestionKey: "suggestionFreeTime" });
    }
    const items = TRIP_PERIODS.flatMap((p) => periods[p]);
    days.push({ dayNumber: n, date, periods, noteKeys: dayNotes(input, items), estimatedCost: dayCost(items) });
  }
  return {
    ok: true,
    dropped,
    plan: { version: 1, inputSignature: tripInputSignature(input), state: planState(days), regionCode: input.regionCode, days, alternatives: planAlternatives(input, candidates, days), travelTimeAvailable: false, source: "MODEL_VALIDATED" },
  };
}
