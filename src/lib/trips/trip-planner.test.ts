import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTripInput, tripDateKeys, tripInputSignature, type TripInput } from "./trip-input";
import { buildTripDay, buildTripPlan, estimateItemCost, periodForHour, rankCandidates } from "./trip-planner";
import { replaceDay } from "./trip-plan-editing";
import { TRIP_PERIODS, TRIP_SUGGESTION_KEYS, type TripBarqItem, type TripCandidate, type TripPlan } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation: the pure input contract and deterministic planner.
// Synthetic candidates only; any outbound request fails the test.

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

const NOW = new Date("2026-10-17T08:00:00Z");
const input = (raw: Record<string, unknown>): TripInput => {
  const r = parseTripInput({ regionCode: "MUSCAT", days: 3, ...raw }, NOW);
  if (!r.ok) throw new Error(`invalid: ${r.fields.join(",")}`);
  return r.value;
};
const cand = (n: number, over: Partial<TripCandidate> = {}): TripCandidate => ({
  serviceId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  name: `Synthetic service ${n}`,
  regionCode: "MUSCAT",
  categorySlug: "adventures",
  durationMinutes: 120,
  prices: [{ amount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON" }],
  requiresSlot: false,
  slotsByDate: {},
  ...over,
});
const items = (plan: TripPlan) => plan.days.flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p]));
const barq = (plan: TripPlan) => items(plan).filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE");

describe("input — only a region and a number of days are required; nothing sensitive is accepted", () => {
  it("minimum input parses with honest defaults", () => {
    const r = parseTripInput({ regionCode: "DHOFAR", days: 2 }, NOW);
    expect(r).toEqual({ ok: true, value: { regionCode: "DHOFAR", days: 2, startDate: null, adults: 2, children: 0, interests: [], pace: "balanced", budgetPerPerson: null, mobility: "own", needs: { accessibility: false, family: false } } });
  });

  it("rejects unknown keys (no name / phone / email / document / plate / VIN can ride along)", () => {
    for (const extra of [{ email: "a@b.c" }, { phone: "+96890000000" }, { name: "X" }, { plateNumber: "1" }, { vin: "X" }, { civilNumber: "1" }]) {
      expect(parseTripInput({ regionCode: "MUSCAT", days: 1, ...extra }, NOW).ok, JSON.stringify(extra)).toBe(false);
    }
    expect(parseTripInput({ regionCode: "MUSCAT", days: 1, needs: { medical: "x" } }, NOW).ok).toBe(false);
  });

  it("validates region, day bounds, past / far dates and party size", () => {
    expect(parseTripInput({ regionCode: "PARIS", days: 2 }, NOW)).toMatchObject({ ok: false, fields: ["regionCode"] });
    expect(parseTripInput({ regionCode: "MUSCAT", days: 0 }, NOW).ok).toBe(false);
    expect(parseTripInput({ regionCode: "MUSCAT", days: 8 }, NOW).ok).toBe(false);
    expect(parseTripInput({ regionCode: "MUSCAT", days: 2, startDate: "2026-10-16" }, NOW)).toMatchObject({ ok: false, fields: ["startDate"] });
    expect(parseTripInput({ regionCode: "MUSCAT", days: 2, startDate: "2028-01-01" }, NOW)).toMatchObject({ ok: false, fields: ["startDate"] });
    expect(parseTripInput({ regionCode: "MUSCAT", days: 2, adults: 15, children: 10 }, NOW).ok).toBe(false);
  });

  it("dates and signature: consecutive Oman day keys; the signature ignores interest order", () => {
    expect(tripDateKeys({ startDate: "2026-12-30", days: 3 })).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(tripDateKeys({ startDate: null, days: 2 })).toEqual([null, null]);
    expect(tripInputSignature(input({ interests: ["beaches", "heritage"] }))).toBe(tripInputSignature(input({ interests: ["heritage", "beaches"] })));
    expect(tripInputSignature(input({ pace: "relaxed" }))).not.toBe(tripInputSignature(input({ pace: "intensive" })));
  });
});

describe("the plan — structured days, real services only, deterministic", () => {
  const candidates = [1, 2, 3, 4, 5, 6, 7].map((n) => cand(n));

  it("minimum input generates a plan: one card per day, each with morning / afternoon / evening", () => {
    const plan = buildTripPlan(input({}), candidates);
    expect(plan.days.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
    for (const d of plan.days) for (const p of TRIP_PERIODS) expect(d.periods[p].length, `${d.dayNumber}.${p}`).toBeGreaterThan(0);
    expect(plan.travelTimeAvailable).toBe(false);
    expect(plan.source).toBe("DETERMINISTIC");
    expect(plan.state).toBe("READY");
  });

  it("every BARQ fact is the candidate's own; no service repeats across the plan", () => {
    const plan = buildTripPlan(input({}), candidates);
    const ids = barq(plan).map((i) => i.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of barq(plan)) {
      const c = candidates.find((x) => x.serviceId === i.serviceId)!;
      expect(c, i.serviceId).toBeTruthy();
      expect(i.name).toBe(c.name);
      expect(i.durationMinutes).toBe(c.durationMinutes);
    }
    for (const i of items(plan)) if (i.kind === "GENERAL_SUGGESTION") expect(TRIP_SUGGESTION_KEYS).toContain(i.suggestionKey);
  });

  it("pace decides how many BARQ services a day holds (relaxed 1 · balanced 2 · intensive 3)", () => {
    for (const [pace, n] of [["relaxed", 1], ["balanced", 2], ["intensive", 3]] as const) {
      const plan = buildTripPlan(input({ pace, days: 2 }), candidates);
      for (const d of plan.days) expect(TRIP_PERIODS.flatMap((p) => d.periods[p]).filter((i) => i.kind === "BARQ_SERVICE").length, pace).toBe(n);
    }
  });

  it("the same input and candidates give the SAME plan (a reload or double tap cannot re-roll); a variant only reorders ties", () => {
    expect(buildTripPlan(input({}), candidates)).toEqual(buildTripPlan(input({}), [...candidates].reverse()));
    expect(barq(buildTripPlan(input({}), candidates, { variant: 3 })).map((i) => i.serviceId)).not.toEqual(barq(buildTripPlan(input({}), candidates)).map((i) => i.serviceId));
  });

  it("no BARQ services in the region → an honest plan of general suggestions, PARTIALLY_AVAILABLE", () => {
    const plan = buildTripPlan(input({}), []);
    expect(barq(plan)).toEqual([]);
    expect(plan.state).toBe("PARTIALLY_AVAILABLE");
    expect(plan.alternatives).toEqual([]);
    for (const d of plan.days) expect(d.estimatedCost).toBeNull();
  });
});

describe("availability — a service that cannot be booked on a day is never offered on it", () => {
  const dated = input({ startDate: "2026-11-01", days: 2, pace: "intensive", adults: 3 });
  const slotDay1 = cand(1, { requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 16, remainingSeats: 5 }] } });
  const fewSeats = cand(2, { requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 9, remainingSeats: 2 }], "2026-11-02": [{ startHour: 9, remainingSeats: 2 }] } });
  const noSlots = cand(3, { requiresSlot: true });
  const slotless = cand(4);

  it("slot service: only on the day it has a slot with enough seats, in the period of that slot", () => {
    const plan = buildTripPlan(dated, [slotDay1, fewSeats, noSlots, slotless]);
    const day1 = plan.days[0]!;
    expect(day1.periods.afternoon[0]).toMatchObject({ serviceId: slotDay1.serviceId, availability: "AVAILABLE_ON_DATE" }); // 16:00 → afternoon
    const ids = barq(plan).map((i) => i.serviceId);
    expect(ids).not.toContain(fewSeats.serviceId); // 2 seats < party of 3
    expect(ids).not.toContain(noSlots.serviceId);
    expect(barq(plan).some((i) => i.availability === "NO_SLOT_ON_DATE")).toBe(false);
    expect(periodForHour(9)).toBe("morning");
    expect(periodForHour(12)).toBe("afternoon");
    expect(periodForHour(17)).toBe("evening");
  });

  it("a slot confirmed on the day outranks equally scored slotless options (it is never crowded out by an id tie-break)", () => {
    const relaxed = input({ startDate: "2026-11-01", days: 1, pace: "balanced" });
    const lateId = cand(9, { requiresSlot: true, slotsByDate: { "2026-11-01": [{ startHour: 9, remainingSeats: 5 }] } });
    const plan = buildTripPlan(relaxed, [cand(1), cand(2), lateId]);
    expect(plan.days[0]!.periods.morning[0]).toMatchObject({ serviceId: lateId.serviceId, availability: "AVAILABLE_ON_DATE" });
    expect(barq(plan)).toHaveLength(2);
  });

  it("without dates nothing is claimed: slot services are DATE_NOT_CHECKED and the day says so", () => {
    const plan = buildTripPlan(input({ days: 1, pace: "intensive" }), [noSlots, slotless]);
    expect(barq(plan).find((i) => i.serviceId === noSlots.serviceId)?.availability).toBe("DATE_NOT_CHECKED");
    expect(plan.days[0]!.noteKeys).toContain("noteBookAhead");
  });
});

describe("cost — the booking calculator over the service's own options; never invented", () => {
  it("PER_PERSON × party, FIXED × 1, range over options; non-bookable units and mixed currencies give no figure", () => {
    expect(estimateItemCost(cand(1, { prices: [{ amount: "12.50", currency: "OMR", pricingUnit: "PER_PERSON" }] }), 3)).toEqual({ min: "37.50", max: "37.50", currency: "OMR" });
    expect(estimateItemCost(cand(1, { prices: [{ amount: "12.50", currency: "OMR", pricingUnit: "PER_PERSON" }, { amount: "60.00", currency: "OMR", pricingUnit: "PER_BOOKING" }] }), 3)).toEqual({ min: "37.50", max: "60.00", currency: "OMR" });
    expect(estimateItemCost(cand(1, { prices: [{ amount: "30.00", currency: "OMR", pricingUnit: "PER_DAY" }] }), 2)).toBeNull();
    expect(estimateItemCost(cand(1, { prices: [{ amount: "1.00", currency: "OMR", pricingUnit: "PER_TRIP" }, { amount: "1.00", currency: "USD", pricingUnit: "PER_TRIP" }] }), 2)).toBeNull();
  });

  it("the per-person budget filters services whose cheapest option exceeds it", () => {
    const pricey = cand(9, { prices: [{ amount: "90.00", currency: "OMR", pricingUnit: "PER_PERSON" }] });
    expect(rankCandidates(input({ budgetPerPerson: 50 }), [cand(1), pricey]).map((c) => c.serviceId)).not.toContain(pricey.serviceId);
    expect(rankCandidates(input({}), [cand(1), pricey]).map((c) => c.serviceId)).toContain(pricey.serviceId);
  });
});

describe("ranking — interests and mobility map only to REAL categories; no claimed match without one", () => {
  it("heritage favours cultural tours; family / food / shopping (no category) change no ranking", () => {
    const cultural = cand(5, { categorySlug: "cultural-tours" });
    const ranked = rankCandidates(input({ interests: ["heritage"] }), [cand(1), cultural]);
    expect(ranked[0]!.serviceId).toBe(cultural.serviceId);
    const neutral = rankCandidates(input({ interests: ["family", "food", "shopping"] }), [cand(1), cultural]).map((c) => c.serviceId);
    expect(neutral).toEqual(rankCandidates(input({}), [cand(1), cultural]).map((c) => c.serviceId));
  });

  it("rental mobility favours car rental services; guided favours tourist guides", () => {
    const car = cand(6, { categorySlug: "cars" });
    const guide = cand(7, { categorySlug: "tourist-guides" });
    expect(rankCandidates(input({ mobility: "rental" }), [cand(1), car, guide])[0]!.serviceId).toBe(car.serviceId);
    expect(rankCandidates(input({ mobility: "guided" }), [cand(1), car, guide])[0]!.serviceId).toBe(guide.serviceId);
  });
});

describe("one-day regeneration never replaces other days", () => {
  it("the new day avoids services on other days; replaceDay changes ONLY that day", () => {
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => cand(n));
    const plan = buildTripPlan(input({}), candidates);
    const keep = plan.days.filter((d) => d.dayNumber !== 2).flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p])).filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE").map((i) => i.serviceId);
    const day2 = buildTripDay(input({}), candidates, 2, { excludeServiceIds: keep, variant: 1 });
    for (const p of TRIP_PERIODS) for (const i of day2.periods[p]) if (i.kind === "BARQ_SERVICE") expect(keep).not.toContain(i.serviceId);
    const next = replaceDay(plan, day2);
    expect(next.days[0]).toBe(plan.days[0]);
    expect(next.days[2]).toBe(plan.days[2]);
    expect(next.days[1]).toBe(day2);
  });
});
