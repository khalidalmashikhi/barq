import "server-only";
import { prisma } from "@/lib/db";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getServiceSlotFacts } from "@/lib/services/bookability-facts";
import { isBookablePricingUnit } from "@/lib/pricing-units/billability";
import { omanDayWindow, utcToOmanDatetimeLocal } from "@/lib/date/oman-time";
import type { Locale } from "@/i18n/locales";
import type { RegionCode } from "@/lib/regions";
import type { TripCandidate } from "./trip-plan";

// 2026-10-17 — Trip planner, grounded foundation. The ONLY place planner facts come from: real
// services that are PUBLISHED by an APPROVED, VISIBLE provider (the same public gate as
// getServices), in the requested region, with at least one ACTIVE price in a BOOKABLE unit.
// Selects the SMALLEST dataset (id, name, region, category slug, duration, bookable price options,
// open slots on the trip days) — never provider identity / contact, descriptions, documents,
// vehicles or registration data. Read-only; bounded (TRIP_MAX_CANDIDATES services, the trip
// window's slots only).

export const TRIP_MAX_CANDIDATES = 40;

/** The public visibility gate (identical to getServices' hard gate — pinned by a test). */
export const TRIP_PUBLIC_SERVICE_GATE = { status: "PUBLISHED" as const, provider: { status: "APPROVED" as const, visible: true } };

export async function getTripCandidates(params: { regionCode: RegionCode; dateKeys: readonly (string | null)[]; locale: Locale }): Promise<TripCandidate[]> {
  const rows = await prisma.service.findMany({
    where: { ...TRIP_PUBLIC_SERVICE_GATE, regionCode: params.regionCode, prices: { some: { status: "ACTIVE" } } },
    orderBy: { createdAt: "desc" },
    take: TRIP_MAX_CANDIDATES,
    select: {
      id: true,
      name: true,
      regionCode: true,
      durationMinutes: true,
      category: { select: { slug: true } },
      prices: { where: { status: "ACTIVE" }, select: { amount: true, currency: true, pricingUnit: true } },
    },
  });
  const usable = rows
    .map((r) => ({ ...r, prices: r.prices.filter((p) => p.pricingUnit !== null && isBookablePricingUnit(p.pricingUnit)) }))
    .filter((r) => r.prices.length > 0);
  if (usable.length === 0) return [];
  const ids = usable.map((r) => r.id);
  const facts = await getServiceSlotFacts(ids);

  // Open slots on the trip days only (none when the customer gave no dates).
  const windows = params.dateKeys.filter((d): d is string => d !== null).map((d) => omanDayWindow(d)).filter((w): w is { start: Date; end: Date } => w !== null);
  const slotsByService = new Map<string, Record<string, { startHour: number; remainingSeats: number }[]>>();
  if (windows.length > 0) {
    const from = windows[0]!.start;
    const to = windows[windows.length - 1]!.end;
    const slots = await prisma.availability.findMany({
      where: { serviceId: { in: ids }, state: "OPEN", startTime: { gte: from > new Date() ? from : new Date(), lt: to } },
      select: { serviceId: true, startTime: true, capacity: true, bookedCount: true },
      orderBy: { startTime: "asc" },
    });
    for (const s of slots) {
      const remaining = s.capacity - s.bookedCount;
      if (remaining <= 0) continue;
      const local = utcToOmanDatetimeLocal(s.startTime); // "YYYY-MM-DDTHH:mm" (Asia/Muscat)
      const date = local.slice(0, 10);
      const map = slotsByService.get(s.serviceId) ?? {};
      (map[date] ??= []).push({ startHour: Number(local.slice(11, 13)), remainingSeats: remaining });
      slotsByService.set(s.serviceId, map);
    }
  }

  return usable.map((r) => ({
    serviceId: r.id,
    name: extractLocalizedText(r.name, params.locale) || (params.locale === "ar" ? "تجربة" : "Experience"),
    regionCode: (r.regionCode as RegionCode | null) ?? null,
    categorySlug: r.category?.slug ?? null,
    durationMinutes: r.durationMinutes ?? null,
    prices: r.prices.map((p) => ({ amount: p.amount.toFixed(2), currency: p.currency, pricingUnit: p.pricingUnit! })),
    requiresSlot: facts.requiresSlot.has(r.id),
    slotsByDate: slotsByService.get(r.id) ?? {},
  }));
}
