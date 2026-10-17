import "server-only";
import { z } from "zod";
import { getActivePricesForService, getServiceById } from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { serviceRequiresSlot } from "@/lib/booking/service-requires-slot";
import { isBookablePricingUnit } from "@/lib/pricing-units/billability";
import { parseOmanDateKey, utcToOmanDatetimeLocal } from "@/lib/date/oman-time";
import type { Locale } from "@/i18n/locales";
import { TRIP_MAX_PARTY } from "./trip-input";
import { availabilityOn, estimateItemCost } from "./trip-planner";
import type { TripCandidate, TripItemAvailability, TripMoney } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation. READ-ONLY revalidation before the customer
// continues to booking: a plan is a snapshot, so price, availability and seats are re-read NOW
// through the same public reads the service page uses (getServiceById gate, active price options,
// open future slots). Nothing is reserved or booked here — the booking flow re-checks everything
// again at submit time (it stays the only authority).

export const TRIP_REVALIDATE_MAX_ITEMS = 21;

const moneySchema = z.object({ min: z.string(), max: z.string(), currency: z.string() }).strict();
const revalidateSchema = z
  .object({
    adults: z.number().int().min(1).max(TRIP_MAX_PARTY),
    children: z.number().int().min(0).max(TRIP_MAX_PARTY),
    items: z
      .array(z.object({ serviceId: z.string().uuid(), date: z.string().nullable(), expectedCost: moneySchema.nullable() }).strict())
      .min(1)
      .max(TRIP_REVALIDATE_MAX_ITEMS),
  })
  .strict();

export type TripItemCheck = {
  serviceId: string;
  date: string | null;
  status: "OK" | "PRICE_CHANGED" | "NO_SLOT_ON_DATE" | "NO_LONGER_AVAILABLE";
  availability: TripItemAvailability | null;
  currentCost: TripMoney | null;
};

export type RevalidateResult = { ok: true; items: TripItemCheck[] } | { ok: false; code: "INVALID_INPUT" };

export async function revalidateTripItems(raw: unknown, locale: Locale): Promise<RevalidateResult> {
  const parsed = revalidateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { adults, children, items } = parsed.data;
  if (items.some((i) => i.date !== null && parseOmanDateKey(i.date) === null)) return { ok: false, code: "INVALID_INPUT" };
  const party = adults + children;

  const candidates = new Map<string, TripCandidate | null>();
  for (const id of [...new Set(items.map((i) => i.serviceId))]) {
    const detail = await getServiceById(id, locale);
    if (!detail) {
      candidates.set(id, null);
      continue;
    }
    const prices = (await getActivePricesForService(id, locale)).filter((p) => p.pricingUnit !== null && isBookablePricingUnit(p.pricingUnit));
    if (prices.length === 0) {
      candidates.set(id, null);
      continue;
    }
    const requiresSlot = await serviceRequiresSlot(id);
    const slotsByDate: TripCandidate["slotsByDate"] = {};
    if (requiresSlot) {
      for (const s of await getAvailableSlots(id)) {
        const local = utcToOmanDatetimeLocal(s.startTime);
        (slotsByDate[local.slice(0, 10)] ??= []).push({ startHour: Number(local.slice(11, 13)), remainingSeats: s.remainingSeats });
      }
    }
    candidates.set(id, {
      serviceId: id,
      name: detail.name,
      regionCode: null,
      categorySlug: null,
      durationMinutes: detail.info.durationMinutes,
      prices: prices.map((p) => ({ amount: Number(p.amount).toFixed(2), currency: p.currency, pricingUnit: p.pricingUnit! })),
      requiresSlot,
      slotsByDate,
    });
  }

  return {
    ok: true,
    items: items.map((i) => {
      const c = candidates.get(i.serviceId) ?? null;
      if (!c) return { serviceId: i.serviceId, date: i.date, status: "NO_LONGER_AVAILABLE", availability: null, currentCost: null };
      const availability = availabilityOn(c, i.date, party);
      const currentCost = estimateItemCost(c, party);
      const priceChanged = i.expectedCost !== null && (currentCost === null || currentCost.min !== i.expectedCost.min || currentCost.max !== i.expectedCost.max || currentCost.currency !== i.expectedCost.currency);
      const status: TripItemCheck["status"] = availability === "NO_SLOT_ON_DATE" ? "NO_SLOT_ON_DATE" : priceChanged ? "PRICE_CHANGED" : "OK";
      return { serviceId: i.serviceId, date: i.date, status, availability, currentCost };
    }),
  };
}
