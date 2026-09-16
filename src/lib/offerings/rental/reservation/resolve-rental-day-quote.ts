import "server-only";
import type { Prisma } from "@prisma/client";
import { omanDateKeyFromDbDate, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { calculateVehicleDailyTotal } from "@/lib/offerings/pricing/calculate-vehicle-daily-total";
import { parseOfferingAmount, checkCapacityOverride } from "../rental-offering-validation";
import {
  assertRentalVerticalCompliant,
  assertRentalVehicleReady,
  RENTAL_VEHICLE_SELECT,
  type DbClient,
  type LoadedRentalVehicle,
} from "../rental-offering-authorization";
import { computeRentalHoldQuoteFingerprint, type RentalHoldDay, type RentalHoldQuote, type RentalPriceSource } from "./reservation-types";

// Phase 3C Slice C3/E1/E2 — the ONE authoritative in-transaction resolver for a daily-rental quote,
// shared by BOTH the C3/E1 hold acquisition and the C3/E2 confirmation. Computing the quote in one
// place is a correctness requirement: acquisition and confirmation must produce byte-identical
// fingerprints/totals for the same offering+dates, or price-drift detection would misfire. It
// re-reads every authority through the supplied tx client (TOCTOU-safe): the public-gated owned
// offering, provider-global vertical compliance, candidate-local vehicle readiness, effective
// bookable capacity, and each selected OPEN day's override-else-base price. Passenger count is
// capacity-only and NEVER multiplies price. Reads NO legacy Price row; touches no guided table.

/** A candidate offering loaded through the public visibility gate (owned, published, rental). */
export type LoadedRentalOfferingForQuote = {
  id: string;
  serviceId: string;
  providerId: string;
  currency: string;
  baseDailyAmount: Prisma.Decimal;
  offeringCapacityOverride: number | null;
  vehicle: LoadedRentalVehicle & {
    make: string | null;
    model: string | null;
    modelYear: number | null;
    color: string | null;
    vehicleType: string | null;
  };
};

export type ResolveRentalDayQuoteResult =
  | {
      ok: true;
      offering: LoadedRentalOfferingForQuote;
      vehicleId: string;
      /** Effective bookable capacity (override ?? verified) validated > 0. */
      effectiveCapacity: number;
      quote: RentalHoldQuote;
      /** Per-date resolved rate (sorted), Decimal amounts — for persisting the price snapshot. */
      resolved: { dateKey: string; amount: Prisma.Decimal; priceSource: RentalPriceSource }[];
    }
  | { ok: false; reason: "NOT_BOOKABLE" | "CAPACITY_EXCEEDED" | "DAY_NOT_AVAILABLE" };

const CANDIDATE_VEHICLE_SELECT = {
  ...RENTAL_VEHICLE_SELECT,
  make: true,
  model: true,
  modelYear: true,
  color: true,
  vehicleType: true,
} as const;

/**
 * Resolve the authoritative quote for a rental offering + a SORTED, unique, non-past set of Oman day
 * keys, on the supplied tx client. Fail-closed + uniform NOT_BOOKABLE for a non-public/ineligible
 * offering, non-compliant vertical, or unready vehicle (cause never revealed); CAPACITY_EXCEEDED when
 * passengerCount exceeds the effective capacity; DAY_NOT_AVAILABLE when any selected day is not an
 * explicit OPEN day with a resolvable price.
 */
export async function resolveRentalDayQuote(
  tx: DbClient,
  params: { offeringId: string; passengerCount: number; sortedDateKeys: string[]; now: Date },
): Promise<ResolveRentalDayQuoteResult> {
  const offeringRow = await tx.rentalOffering.findFirst({
    where: {
      id: params.offeringId,
      status: "PUBLISHED",
      service: { status: "PUBLISHED", offeringKind: "VEHICLE_RENTAL", provider: { status: "APPROVED", visible: true } },
      vehicle: { asset: { assetType: "VEHICLE" } },
    },
    select: {
      id: true,
      serviceId: true,
      currency: true,
      baseDailyAmount: true,
      offeringCapacityOverride: true,
      service: { select: { providerId: true } },
      vehicle: { select: CANDIDATE_VEHICLE_SELECT },
    },
  });
  if (!offeringRow) return { ok: false, reason: "NOT_BOOKABLE" };
  const offering: LoadedRentalOfferingForQuote = {
    id: offeringRow.id,
    serviceId: offeringRow.serviceId,
    providerId: offeringRow.service.providerId,
    currency: offeringRow.currency,
    baseDailyAmount: offeringRow.baseDailyAmount,
    offeringCapacityOverride: offeringRow.offeringCapacityOverride,
    vehicle: offeringRow.vehicle as unknown as LoadedRentalOfferingForQuote["vehicle"],
  };
  const vehicleId = offering.vehicle.assetId;

  if ((await assertRentalVerticalCompliant(tx, offering.providerId)) !== null) return { ok: false, reason: "NOT_BOOKABLE" };
  if (assertRentalVehicleReady(offering.vehicle, params.now) !== null) return { ok: false, reason: "NOT_BOOKABLE" };

  const cap = checkCapacityOverride(offering.vehicle.bookablePassengerCapacity, offering.offeringCapacityOverride);
  if (!cap.ok || cap.effectiveCapacity === null) return { ok: false, reason: "NOT_BOOKABLE" };
  if (params.passengerCount > cap.effectiveCapacity) return { ok: false, reason: "CAPACITY_EXCEEDED" };

  const base = parseOfferingAmount(offering.baseDailyAmount);
  if (base === null) return { ok: false, reason: "NOT_BOOKABLE" };

  const dbDates = params.sortedDateKeys.map((k) => dbDateFromOmanDateKey(k)!);
  const dayRows = (await tx.rentalOfferingDay.findMany({
    where: { rentalOfferingId: offering.id, serviceDate: { in: dbDates } },
    select: { serviceDate: true, state: true, dailyAmountOverride: true },
  })) as unknown as { serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[];
  const byKey = new Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>();
  for (const r of dayRows) byKey.set(omanDateKeyFromDbDate(r.serviceDate), { state: r.state, override: r.dailyAmountOverride });

  const resolved: { dateKey: string; amount: Prisma.Decimal; priceSource: RentalPriceSource }[] = [];
  for (const dateKey of params.sortedDateKeys) {
    const row = byKey.get(dateKey);
    if (!row || row.state !== "OPEN") return { ok: false, reason: "DAY_NOT_AVAILABLE" };
    if (row.override !== null) {
      const override = parseOfferingAmount(row.override);
      if (override === null) return { ok: false, reason: "DAY_NOT_AVAILABLE" };
      resolved.push({ dateKey, amount: override, priceSource: "OVERRIDE" });
    } else {
      resolved.push({ dateKey, amount: base, priceSource: "BASE" });
    }
  }

  const calc = calculateVehicleDailyTotal(resolved.map((r) => ({ dateKey: r.dateKey, money: { amount: r.amount, currency: offering.currency } })));
  if (!calc.ok) return { ok: false, reason: "DAY_NOT_AVAILABLE" };
  const days: RentalHoldDay[] = resolved.map((r) => ({ dateKey: r.dateKey, amount: r.amount.toFixed(2), currency: offering.currency, priceSource: r.priceSource }));
  const quote: RentalHoldQuote = {
    offeringId: offering.id,
    vehicleId,
    serviceId: offering.serviceId,
    currency: calc.value.currency,
    dateKeys: calc.value.dateKeys,
    days,
    chargeableDays: calc.value.chargeableDays,
    total: calc.value.total,
    lowestDailyRate: calc.value.lowestDailyRate,
    quoteFingerprint: computeRentalHoldQuoteFingerprint({ offeringId: offering.id, currency: calc.value.currency, total: calc.value.total, days }),
  };
  return { ok: true, offering, vehicleId, effectiveCapacity: cap.effectiveCapacity, quote, resolved };
}
