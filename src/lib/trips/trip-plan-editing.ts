import { TRIP_PERIODS, type TripBarqItem, type TripBarqItemOption, type TripDay, type TripItem, type TripMoney, type TripPeriod, type TripPlan } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation. PURE, client-safe plan edits (no Prisma, no
// network): remove, move, replace an activity, and replace ONE regenerated day. Edits never invent
// facts: a moved or swapped-in service's date availability is reset to "not checked" (it is re-read
// by revalidation before booking) and a swapped-in service has no cost until revalidated.

/** Sum of the day's computable BARQ costs (same currency only); `partial` when any is unknown. */
export function dayCost(items: readonly TripItem[]): TripDay["estimatedCost"] {
  const barq = items.filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE");
  if (barq.length === 0) return null;
  const known = barq.map((i) => i.estimatedCost).filter((c): c is TripMoney => c !== null);
  if (known.length === 0) return null;
  const currency = known[0]!.currency;
  if (known.some((c) => c.currency !== currency)) return null;
  const sum = (k: "min" | "max") => known.reduce((acc, c) => acc + Math.round(Number(c[k]) * 100), 0);
  return { min: (sum("min") / 100).toFixed(2), max: (sum("max") / 100).toFixed(2), currency, partial: known.length < barq.length };
}

const FALLBACK: TripItem = { kind: "GENERAL_SUGGESTION", suggestionKey: "suggestionFreeTime" };

function withDay(plan: TripPlan, dayNumber: number, update: (d: TripDay) => TripDay): TripPlan {
  return { ...plan, days: plan.days.map((d) => (d.dayNumber === dayNumber ? recost(update(d)) : d)) };
}

function recost(d: TripDay): TripDay {
  const periods = Object.fromEntries(TRIP_PERIODS.map((p) => [p, d.periods[p].length > 0 ? d.periods[p] : [FALLBACK]])) as Record<TripPeriod, TripItem[]>;
  return { ...d, periods, estimatedCost: dayCost(TRIP_PERIODS.flatMap((p) => periods[p])) };
}

export function removeItem(plan: TripPlan, dayNumber: number, period: TripPeriod, index: number): TripPlan {
  return withDay(plan, dayNumber, (d) => ({ ...d, periods: { ...d.periods, [period]: d.periods[period].filter((_, i) => i !== index) } }));
}

/** Move a BARQ item to the same period of another day; its date availability becomes "not checked". */
export function moveItem(plan: TripPlan, fromDay: number, period: TripPeriod, index: number, toDay: number): TripPlan {
  if (fromDay === toDay) return plan;
  const item = plan.days.find((d) => d.dayNumber === fromDay)?.periods[period][index];
  if (!item || item.kind !== "BARQ_SERVICE" || !plan.days.some((d) => d.dayNumber === toDay)) return plan;
  const target = plan.days.find((d) => d.dayNumber === toDay)!;
  const moved: TripBarqItem = { ...item, availability: target.date === null || item.availability === "SLOTLESS" ? item.availability : "DATE_NOT_CHECKED" };
  const removed = removeItem(plan, fromDay, period, index);
  return withDay(removed, toDay, (d) => ({ ...d, periods: { ...d.periods, [period]: [...d.periods[period].filter((i) => i.kind === "BARQ_SERVICE"), moved] } }));
}

/** Replace an item with an unused alternative from the plan (availability / cost re-read on booking). */
export function replaceItem(plan: TripPlan, dayNumber: number, period: TripPeriod, index: number, alt: TripBarqItemOption): TripPlan {
  if (!plan.alternatives.some((a) => a.serviceId === alt.serviceId)) return plan;
  const incoming: TripBarqItem = { kind: "BARQ_SERVICE", serviceId: alt.serviceId, name: alt.name, durationMinutes: alt.durationMinutes, availability: "DATE_NOT_CHECKED", estimatedCost: null };
  const outgoing = plan.days.find((d) => d.dayNumber === dayNumber)?.periods[period][index];
  const next = withDay(plan, dayNumber, (d) => ({ ...d, periods: { ...d.periods, [period]: d.periods[period].map((it, i) => (i === index ? incoming : it)) } }));
  const back: TripBarqItemOption[] = outgoing && outgoing.kind === "BARQ_SERVICE" ? [{ serviceId: outgoing.serviceId, name: outgoing.name, durationMinutes: outgoing.durationMinutes }] : [];
  return { ...next, alternatives: [...next.alternatives.filter((a) => a.serviceId !== alt.serviceId), ...back] };
}

/** Put ONE regenerated day in place — every other day is left exactly as it was. */
export function replaceDay(plan: TripPlan, day: TripDay): TripPlan {
  if (!plan.days.some((d) => d.dayNumber === day.dayNumber)) return plan;
  return { ...plan, days: plan.days.map((d) => (d.dayNumber === day.dayNumber ? day : d)) };
}

/** The BARQ services placed on every day except `exceptDay` (kept out of a regenerated day). */
export function servicesOutside(plan: TripPlan, exceptDay: number): string[] {
  return plan.days
    .filter((d) => d.dayNumber !== exceptDay)
    .flatMap((d) => TRIP_PERIODS.flatMap((p) => d.periods[p]))
    .filter((i): i is TripBarqItem => i.kind === "BARQ_SERVICE")
    .map((i) => i.serviceId);
}

/** True when ANY day holds a real BARQ service (an all-general plan gets a different, honest notice). */
export function hasBarqService(plan: TripPlan): boolean {
  return plan.days.some((d) => TRIP_PERIODS.some((p) => d.periods[p].some((i) => i.kind === "BARQ_SERVICE")));
}

/** Stale-response guard: only the LATEST request for the CURRENT preferences may update the plan. */
export function isCurrentResponse(requestSeq: number, latestSeq: number, responseSignature: string, currentSignature: string): boolean {
  return requestSeq === latestSeq && responseSignature === currentSignature;
}
