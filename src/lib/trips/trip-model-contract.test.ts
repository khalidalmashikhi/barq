import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTripInput, type TripInput } from "./trip-input";
import { buildTripModelRequest, validateTripModelOutput } from "./trip-model-contract";
import { buildTripPlan } from "./trip-planner";
import { hasBarqService, isCurrentResponse, moveItem, removeItem, replaceItem, servicesOutside } from "./trip-plan-editing";
import { TRIP_PERIODS, type TripBarqItem, type TripCandidate } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation: the future-model boundary (minimal request,
// strict fail-closed validation, facts rehydrated from BARQ) and the client-side plan edits.

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

const NOW = new Date("2026-10-17T08:00:00Z");
const input = (raw: Record<string, unknown> = {}): TripInput => {
  const r = parseTripInput({ regionCode: "MUSCAT", days: 2, ...raw }, NOW);
  if (!r.ok) throw new Error("invalid");
  return r.value;
};
const cand = (n: number, over: Partial<TripCandidate> = {}): TripCandidate => ({
  serviceId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Synthetic service ${n}`,
  regionCode: "MUSCAT",
  categorySlug: "adventures",
  durationMinutes: 90,
  prices: [{ amount: "15.00", currency: "OMR", pricingUnit: "PER_PERSON" }],
  requiresSlot: false,
  slotsByDate: {},
  ...over,
});
const candidates = [cand(1), cand(2), cand(3, { requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 10, remainingSeats: 4 }] } })];

describe("the model request is the SMALLEST dataset — no names, prices, ids or private data", () => {
  it("anonymous refs, category, duration and dates only; the ref → service map stays server-side", () => {
    const { request, refs } = buildTripModelRequest(input(), candidates);
    const json = JSON.stringify(request);
    for (const c of candidates) {
      expect(json).not.toContain(c.serviceId);
      expect(json).not.toContain(c.name);
    }
    expect(json).not.toMatch(/"amount"|"currency"|"price|provider|description|plate|vin|engine|registration|phone|email/i);
    expect(Object.keys(request.options[0]!).sort()).toEqual(["availableDates", "category", "durationMinutes", "needsDate", "ref"]);
    expect(request.party).toEqual({ adults: 2, children: 0 });
    expect(refs.get("s1")).toBe(candidates[0]);
  });
});

describe("model output is validated deterministically and fails closed", () => {
  const { refs } = buildTripModelRequest(input(), candidates);
  const good = {
    days: [
      { dayNumber: 1, morning: [{ ref: "s1" }], afternoon: [{ suggestion: "suggestionRest" }], evening: [] },
      { dayNumber: 2, morning: [{ ref: "s2" }], afternoon: [], evening: [{ suggestion: "suggestionEveningStroll" }] },
    ],
  };

  it("a valid answer is REHYDRATED from the candidate — names, durations, costs never come from the model", () => {
    const r = validateTripModelOutput(good, input(), candidates, refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const first = r.plan.days[0]!.periods.morning[0] as TripBarqItem;
    expect(first).toEqual({ kind: "BARQ_SERVICE", serviceId: candidates[0]!.serviceId, name: "Synthetic service 1", durationMinutes: 90, availability: "SLOTLESS", estimatedCost: { min: "30.00", max: "30.00", currency: "OMR" } });
    expect(r.plan.source).toBe("MODEL_VALIDATED");
    for (const d of r.plan.days) for (const p of TRIP_PERIODS) expect(d.periods[p].length).toBeGreaterThan(0); // empty periods get a fixed general suggestion
  });

  it("malformed output is rejected: free text, invented prices / names, extra keys, wrong types", () => {
    for (const bad of [
      null,
      "Day 1: visit the souq",
      { days: [{ dayNumber: 1, morning: [{ ref: "s1", name: "Invented" }], afternoon: [], evening: [] }, { dayNumber: 2, morning: [], afternoon: [], evening: [] }] },
      { days: [{ dayNumber: 1, morning: [{ text: "anything" }], afternoon: [], evening: [] }, { dayNumber: 2, morning: [], afternoon: [], evening: [] }] },
      { days: [{ dayNumber: 1, morning: [{ suggestion: "visitTheFort" }], afternoon: [], evening: [] }, { dayNumber: 2, morning: [], afternoon: [], evening: [] }] },
      { days: [{ dayNumber: 1, morning: [], afternoon: [], evening: [], price: "5 OMR" }, { dayNumber: 2, morning: [], afternoon: [], evening: [] }] },
      { ...good, travelMinutes: 30 },
    ]) {
      expect(validateTripModelOutput(bad, input(), candidates, refs), JSON.stringify(bad)).toEqual({ ok: false, reason: "MALFORMED" });
    }
  });

  it("the wrong number of days is rejected", () => {
    expect(validateTripModelOutput({ days: [good.days[0]] }, input(), candidates, refs)).toEqual({ ok: false, reason: "WRONG_DAY_COUNT" });
  });

  it("unknown refs, repeated services and services not bookable on that day are DROPPED, never shown", () => {
    const dated = input({ startDate: "2026-11-01" });
    const datedRefs = buildTripModelRequest(dated, candidates).refs;
    const r = validateTripModelOutput(
      {
        days: [
          { dayNumber: 1, morning: [{ ref: "s99" }], afternoon: [{ ref: "s1" }], evening: [{ ref: "s1" }] },
          { dayNumber: 2, morning: [{ ref: "s3" }], afternoon: [], evening: [] }, // s3 has no slot on 2026-11-02
        ],
      },
      dated,
      candidates,
      datedRefs,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(3);
    const ids = r.plan.days.flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p])).filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE").map((i) => i.serviceId);
    expect(ids).toEqual([candidates[0]!.serviceId]);
  });
});

describe("plan edits (client-safe) never invent facts", () => {
  const plan = buildTripPlan(input({ startDate: "2026-11-01", pace: "balanced" }), [cand(1), cand(2), cand(4), cand(5), cand(6)]);

  it("remove: the period falls back to a general suggestion and the day cost is recomputed", () => {
    const period = TRIP_PERIODS.find((p) => plan.days[0]!.periods[p][0]?.kind === "BARQ_SERVICE")!;
    const next = removeItem(plan, 1, period, 0);
    expect(next.days[0]!.periods[period]).toEqual([{ kind: "GENERAL_SUGGESTION", suggestionKey: "suggestionFreeTime" }]);
    expect(next.days[1]).toBe(plan.days[1]);
  });

  it("move: the service lands on the other day with its date availability reset to 'not checked' unless slotless", () => {
    const withSlot = buildTripPlan(input({ startDate: "2026-11-01" }), [cand(3, { requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 9, remainingSeats: 4 }] } })]);
    const next = moveItem(withSlot, 1, "morning", 0, 2);
    const moved = next.days[1]!.periods.morning.find((i) => i.kind === "BARQ_SERVICE") as TripBarqItem;
    expect(moved.availability).toBe("DATE_NOT_CHECKED");
    expect(next.days[0]!.periods.morning[0]!.kind).toBe("GENERAL_SUGGESTION");
  });

  it("replace: only with one of the plan's own alternatives; the swapped-in service has no cost until revalidated", () => {
    expect(plan.alternatives.length).toBeGreaterThan(0);
    const period = TRIP_PERIODS.find((p) => plan.days[0]!.periods[p][0]?.kind === "BARQ_SERVICE")!;
    const alt = plan.alternatives[0]!;
    const next = replaceItem(plan, 1, period, 0, alt);
    expect(next.days[0]!.periods[period][0]).toEqual({ kind: "BARQ_SERVICE", serviceId: alt.serviceId, name: alt.name, durationMinutes: alt.durationMinutes, availability: "DATE_NOT_CHECKED", estimatedCost: null });
    expect(next.alternatives.map((a) => a.serviceId)).not.toContain(alt.serviceId);
    expect(replaceItem(plan, 1, period, 0, { serviceId: "not-an-alternative", name: "Invented", durationMinutes: 1 })).toBe(plan);
  });

  it("stale-response guard: only the latest request for the current preferences applies", () => {
    expect(isCurrentResponse(3, 3, "sig", "sig")).toBe(true);
    expect(isCurrentResponse(2, 3, "sig", "sig")).toBe(false); // an older request answered late
    expect(isCurrentResponse(3, 3, "old", "new")).toBe(false); // preferences changed meanwhile
    expect(hasBarqService(plan)).toBe(true);
    expect(hasBarqService(buildTripPlan(input(), []))).toBe(false); // all-general plan → the "no services in this region" notice
    expect(servicesOutside(plan, 1)).not.toEqual(expect.arrayContaining(plan.days[0]!.periods.morning.filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE").map((i) => i.serviceId)));
  });
});
