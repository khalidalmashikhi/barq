import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  parseOmanDateKey,
  isOmanPastDateKey,
  dbDateFromOmanDateKey,
  omanDateKeyFromDbDate,
} from "@/lib/date/oman-time";
import { calculateVehicleDailyTotal } from "@/lib/offerings/pricing/calculate-vehicle-daily-total";
import { parseOfferingAmount, checkCapacityOverride } from "../rental-offering-validation";
import {
  assertRentalVerticalCompliant,
  assertRentalVehicleReady,
  isUniqueViolation,
  RENTAL_VEHICLE_SELECT,
  type LoadedRentalVehicle,
} from "../rental-offering-authorization";
import { expireStaleHoldsForVehicleDates } from "./expire-stale-daily-rental-holds";
import {
  RENTAL_HOLD_TTL_MINUTES,
  MAX_RENTAL_HOLD_DATES,
  computeRentalHoldRequestFingerprint,
  computeRentalHoldQuoteFingerprint,
  type AcquireDailyRentalHoldResult,
  type DailyRentalHold,
  type ExpectedQuote,
  type RentalHoldDay,
  type RentalHoldQuote,
  type RentalPriceSource,
} from "./reservation-types";

// Phase 3C Slice C3/E1 — the AUTHORITATIVE, server-only atomic hold-acquisition. It holds a physical
// rental vehicle for a set of Oman days (one selected day, a continuous range, or non-consecutive
// days) ALL-OR-NOTHING. The core safety invariant — one active reservation per (vehicle, day) — is
// enforced by the DB PARTIAL UNIQUE INDEX (the sole race arbiter); this function re-reads every
// authority INSIDE the transaction (TOCTOU-safe), resolves each day's authoritative price, and either
// inserts every day's hold row or none. It NEVER accepts a provider identity from client input, never
// lets client input set expiry, never multiplies price by passenger count, and reads NO legacy Price.
//
// READ-ONLY boundary: it writes ONLY rental_vehicle_day_reservations (+ its own in-tx AuditLog). It
// creates NO Booking, touches NO payment, and never writes an offering/day/start-time row.

/** Row shape loaded for a candidate offering (public-gated, owned vehicle). */
type LoadedOffering = {
  id: string;
  serviceId: string;
  currency: string;
  baseDailyAmount: Prisma.Decimal;
  offeringCapacityOverride: number | null;
  providerId: string;
  vehicle: LoadedRentalVehicle;
};

export type AcquireDailyRentalHoldParams = {
  /** Server-DERIVED authenticated owner (requireCustomer → customer.id). NEVER client-supplied. */
  customerId: string;
  offeringId: string;
  /** Raw selected Oman day keys (any order). Duplicates/malformed/past are rejected, not silently fixed. */
  dateKeys: string[];
  /** Party size — capacity validation ONLY; never a price factor. */
  passengerCount: number;
  /** Optional opaque per-customer idempotency key. */
  idempotencyKey?: string | null;
  /** Optional client-expected quote, used ONLY for price-drift detection. */
  expectedQuote?: ExpectedQuote | null;
  /** Injectable clock for deterministic tests. */
  now?: Date;
};

/** Build the safe hold DTO + quote from a set of reservation rows (one hold group). */
function buildHold(
  rows: { serviceDate: Date; dailyAmount: Prisma.Decimal; currency: string; priceSource: string; holdGroupId: string; holdToken: string; expiresAt: Date | null }[],
  offering: { id: string; vehicleId: string; serviceId: string },
  replayed: boolean,
): DailyRentalHold | null {
  const first = rows[0];
  if (!first || first.expiresAt === null) return null;
  const days: RentalHoldDay[] = rows
    .map((r) => ({ dateKey: omanDateKeyFromDbDate(r.serviceDate), amount: r.dailyAmount.toFixed(2), currency: r.currency, priceSource: r.priceSource as RentalPriceSource }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const calc = calculateVehicleDailyTotal(days.map((d) => ({ dateKey: d.dateKey, money: { amount: d.amount, currency: d.currency } })));
  if (!calc.ok) return null;
  const quote: RentalHoldQuote = {
    offeringId: offering.id,
    vehicleId: offering.vehicleId,
    serviceId: offering.serviceId,
    currency: calc.value.currency,
    dateKeys: calc.value.dateKeys,
    days,
    chargeableDays: calc.value.chargeableDays,
    total: calc.value.total,
    lowestDailyRate: calc.value.lowestDailyRate,
    quoteFingerprint: computeRentalHoldQuoteFingerprint({ offeringId: offering.id, currency: calc.value.currency, total: calc.value.total, days }),
  };
  return { holdGroupId: first.holdGroupId, holdToken: first.holdToken, status: "HELD", expiresAt: first.expiresAt.toISOString(), quote, replayed };
}

const REPLAY_SELECT = {
  serviceDate: true,
  dailyAmount: true,
  currency: true,
  priceSource: true,
  holdGroupId: true,
  holdToken: true,
  expiresAt: true,
  requestFingerprint: true,
  rentalOfferingId: true,
  vehicleId: true,
  serviceId: true,
} as const;

/**
 * Look up an ACTIVE hold group for (customer, idempotencyKey). Returns a replay hold when a group
 * with the SAME request fingerprint exists, an idempotency mismatch when an active group exists with
 * a DIFFERENT fingerprint, or null when there is none. Ignores expired HELD / released / cancelled.
 */
async function findActiveHoldByKey(
  db: PrismaClient,
  customerId: string,
  idempotencyKey: string,
  requestFingerprint: string,
  now: Date,
): Promise<{ replay: DailyRentalHold } | { mismatch: true } | null> {
  const rows = (await db.rentalVehicleDayReservation.findMany({
    where: { customerId, idempotencyKey, OR: [{ status: "CONFIRMED" }, { status: "HELD", expiresAt: { gt: now } }] },
    select: REPLAY_SELECT,
  })) as unknown as ({ requestFingerprint: string | null; holdGroupId: string; rentalOfferingId: string; vehicleId: string; serviceId: string } & Parameters<typeof buildHold>[0][number])[];
  if (rows.length === 0) return null;
  const matching = rows.filter((r) => r.requestFingerprint === requestFingerprint);
  if (matching.length > 0) {
    const g = matching[0]!;
    const hold = buildHold(matching, { id: g.rentalOfferingId, vehicleId: g.vehicleId, serviceId: g.serviceId }, true);
    if (hold) return { replay: hold };
  }
  return { mismatch: true };
}

/** Canonicalize + validate the selected day keys (pure). */
function normalizeSelection(dateKeys: string[], now: Date): { ok: true; keys: string[] } | { ok: false } {
  if (!Array.isArray(dateKeys) || dateKeys.length === 0) return { ok: false };
  if (dateKeys.length > MAX_RENTAL_HOLD_DATES) return { ok: false };
  const seen = new Set<string>();
  for (const raw of dateKeys) {
    const key = parseOmanDateKey(raw);
    if (key === null) return { ok: false };
    if (seen.has(key)) return { ok: false }; // duplicate — never silently deduped
    if (isOmanPastDateKey(key, now)) return { ok: false };
    seen.add(key);
  }
  return { ok: true, keys: [...seen].sort() };
}

export async function acquireDailyRentalHold(
  prisma: PrismaClient,
  params: AcquireDailyRentalHoldParams,
): Promise<AcquireDailyRentalHoldResult> {
  const now = params.now ?? new Date();

  // ---- Pure input validation (pre-transaction). ----
  if (!Number.isInteger(params.passengerCount) || params.passengerCount <= 0) return { ok: false, reason: "INVALID_PASSENGER_COUNT" };
  const selection = normalizeSelection(params.dateKeys, now);
  if (!selection.ok) return { ok: false, reason: "INVALID_SELECTION" };
  const sortedKeys = selection.keys;
  const idempotencyKey = params.idempotencyKey ?? null;
  const requestFingerprint = computeRentalHoldRequestFingerprint({ offeringId: params.offeringId, dateKeys: sortedKeys, passengerCount: params.passengerCount });

  try {
    // ---- Idempotency fast path: replay an existing active group, or fail on a fingerprint mismatch. ----
    if (idempotencyKey !== null) {
      const existing = await findActiveHoldByKey(prisma, params.customerId, idempotencyKey, requestFingerprint, now);
      if (existing && "replay" in existing) return { ok: true, hold: existing.replay };
      if (existing && "mismatch" in existing) return { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
    }

    const dbDates = sortedKeys.map((k) => dbDateFromOmanDateKey(k)!);

    const result = await prisma.$transaction(async (tx) => {
      // Owner still exists (TOCTOU: could have been removed after the session was derived).
      const customer = await tx.customer.findUnique({ where: { id: params.customerId }, select: { id: true } });
      if (!customer) return { ok: false as const, reason: "NOT_BOOKABLE" as const };

      // Publicly-visible VEHICLE_RENTAL offering the (approved, visible) provider owns. Non-enumerating.
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
          vehicle: { select: RENTAL_VEHICLE_SELECT },
        },
      });
      if (!offeringRow) return { ok: false as const, reason: "NOT_BOOKABLE" as const };
      const offering: LoadedOffering = {
        id: offeringRow.id,
        serviceId: offeringRow.serviceId,
        currency: offeringRow.currency,
        baseDailyAmount: offeringRow.baseDailyAmount,
        offeringCapacityOverride: offeringRow.offeringCapacityOverride,
        providerId: offeringRow.service.providerId,
        vehicle: offeringRow.vehicle as unknown as LoadedRentalVehicle,
      };
      const vehicleId = offering.vehicle.assetId;

      // Provider-global vertical compliance + candidate-local vehicle readiness (reused authorities).
      if ((await assertRentalVerticalCompliant(tx, offering.providerId)) !== null) return { ok: false as const, reason: "NOT_BOOKABLE" as const };
      if (assertRentalVehicleReady(offering.vehicle, now) !== null) return { ok: false as const, reason: "NOT_BOOKABLE" as const };

      // Capacity: passenger count validates against the effective bookable ceiling; NEVER a price factor.
      const cap = checkCapacityOverride(offering.vehicle.bookablePassengerCapacity, offering.offeringCapacityOverride);
      if (!cap.ok || cap.effectiveCapacity === null) return { ok: false as const, reason: "NOT_BOOKABLE" as const };
      if (params.passengerCount > cap.effectiveCapacity) return { ok: false as const, reason: "CAPACITY_EXCEEDED" as const };

      // Base rate must be valid (fail closed).
      const base = parseOfferingAmount(offering.baseDailyAmount);
      if (base === null) return { ok: false as const, reason: "NOT_BOOKABLE" as const };

      // Resolve every selected day: each MUST be an explicit OPEN row with a resolvable price.
      const dayRows = (await tx.rentalOfferingDay.findMany({
        where: { rentalOfferingId: offering.id, serviceDate: { in: dbDates } },
        select: { serviceDate: true, state: true, dailyAmountOverride: true },
      })) as unknown as { serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[];
      const byKey = new Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>();
      for (const r of dayRows) byKey.set(omanDateKeyFromDbDate(r.serviceDate), { state: r.state, override: r.dailyAmountOverride });

      const resolved: { dateKey: string; amount: Prisma.Decimal; priceSource: RentalPriceSource }[] = [];
      for (const dateKey of sortedKeys) {
        const row = byKey.get(dateKey);
        if (!row || row.state !== "OPEN") return { ok: false as const, reason: "DAY_NOT_AVAILABLE" as const };
        if (row.override !== null) {
          const override = parseOfferingAmount(row.override);
          if (override === null) return { ok: false as const, reason: "DAY_NOT_AVAILABLE" as const }; // malformed → fail closed
          resolved.push({ dateKey, amount: override, priceSource: "OVERRIDE" });
        } else {
          resolved.push({ dateKey, amount: base, priceSource: "BASE" });
        }
      }

      // Authoritative total via the shared C2a calculator (passenger count is not an input to it).
      const calc = calculateVehicleDailyTotal(resolved.map((r) => ({ dateKey: r.dateKey, money: { amount: r.amount, currency: offering.currency } })));
      if (!calc.ok) return { ok: false as const, reason: "DAY_NOT_AVAILABLE" as const };
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

      // Price-drift: recomputed authoritative quote vs the client's expected quote. No write on drift.
      const expected = params.expectedQuote ?? null;
      if (expected !== null) {
        const fpMismatch = "fingerprint" in expected && expected.fingerprint !== quote.quoteFingerprint;
        const totalMismatch = "total" in expected && (expected.total !== quote.total || expected.currency !== quote.currency);
        if (fpMismatch || totalMismatch) return { ok: false as const, reason: "PRICE_CHANGED" as const, quote };
      }

      // Expire stale HELD rows for exactly the targeted vehicle/dates before acquisition (frees lapsed
      // inventory so the unique index does not reject on a hold that is logically expired). Shared rule.
      await expireStaleHoldsForVehicleDates(tx, vehicleId, dbDates, now);

      // Insert all day rows atomically. A unique-index conflict on ANY date aborts the whole INSERT →
      // the transaction rolls back (no partial hold, no audit) and the P2002 is mapped outside.
      const holdGroupId = randomUUID();
      const holdToken = randomBytes(24).toString("hex");
      const expiresAt = new Date(now.getTime() + RENTAL_HOLD_TTL_MINUTES * 60_000);
      await tx.rentalVehicleDayReservation.createMany({
        data: resolved.map((r) => ({
          holdGroupId,
          holdToken,
          customerId: params.customerId,
          serviceId: offering.serviceId,
          rentalOfferingId: offering.id,
          vehicleId,
          serviceDate: dbDateFromOmanDateKey(r.dateKey)!,
          status: "HELD" as const,
          dailyAmount: r.amount,
          currency: offering.currency,
          priceSource: r.priceSource,
          expiresAt,
          idempotencyKey,
          requestFingerprint: idempotencyKey !== null ? requestFingerprint : null,
        })),
      });

      // Success audit INSIDE the transaction (its failure rolls the hold back). No content beyond
      // structured identifiers + the authoritative quote; actorId is the owner's own id.
      await tx.auditLog.create({
        data: {
          actorType: "CUSTOMER",
          actorId: params.customerId,
          action: "rental.daily_hold_acquired",
          entityType: "RentalVehicleDayReservation",
          entityId: holdGroupId,
          newValue: {
            holdGroupId,
            offeringId: offering.id,
            vehicleId,
            serviceId: offering.serviceId,
            dateKeys: quote.dateKeys,
            currency: quote.currency,
            total: quote.total,
            chargeableDays: quote.chargeableDays,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      const hold: DailyRentalHold = { holdGroupId, holdToken, status: "HELD", expiresAt: expiresAt.toISOString(), quote, replayed: false };
      return { ok: true as const, hold };
    });

    return result;
  } catch (error) {
    // The DB arbiter rejected a selected vehicle/day (concurrent acquisition won the race).
    if (isUniqueViolation(error)) {
      // Idempotent convergence: a concurrent IDENTICAL request may have just committed under the same
      // key — replay it instead of surfacing a conflict. A different-fingerprint group → mismatch.
      if (idempotencyKey !== null) {
        try {
          const existing = await findActiveHoldByKey(prisma, params.customerId, idempotencyKey, requestFingerprint, now);
          if (existing && "replay" in existing) return { ok: true, hold: existing.replay };
          if (existing && "mismatch" in existing) return { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
        } catch {
          /* fall through to conflict */
        }
      }
      return { ok: false, reason: "VEHICLE_DATE_CONFLICT" };
    }
    logger.error("acquireDailyRentalHold.read_failed", {
      offeringId: params.offeringId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "READ_FAILED" };
  }
}
