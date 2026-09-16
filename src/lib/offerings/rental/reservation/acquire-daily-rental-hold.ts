import "server-only";
import { randomBytes } from "node:crypto";
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
  type RentalHoldStatus,
  type RentalPriceSource,
} from "./reservation-types";

// Phase 3C Slice C3/E1 — the AUTHORITATIVE, server-only atomic hold-acquisition. It holds a physical
// rental vehicle for a set of Oman days (one day, a continuous range, or non-consecutive days)
// ALL-OR-NOTHING. TWO database invariants back it, each with its OWN arbiter:
//   • GROUP idempotency — a HOLD-GROUP HEADER row (rental_vehicle_day_hold_groups) carries the
//     identity, and its UNIQUE(customerId, idempotencyKey) guarantees at most ONE logical request
//     per (customer, key), independent of the number of date rows. The header is claimed FIRST.
//   • PHYSICAL vehicle/day — the child rows' PARTIAL UNIQUE (vehicleId, serviceDate) WHERE active
//     guarantees a vehicle is never double-held for one Oman day.
// It re-reads every authority INSIDE the transaction (TOCTOU-safe), resolves each day's authoritative
// price, and inserts the header + every child row (or none). It NEVER accepts a provider identity
// from client input, never lets client input set expiry, never multiplies price by passenger count,
// and reads NO legacy Price. READ-ONLY boundary: it writes ONLY the two reservation tables (+ its own
// in-tx AuditLog); it creates NO Booking, touches NO payment, and never writes an offering/day row.

/** How many times to retry the whole acquisition when the group-unique winner rolled back (rare). */
const MAX_ACQUIRE_ATTEMPTS = 3;

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

type GroupWithReservations = {
  id: string;
  holdToken: string;
  rentalOfferingId: string;
  vehicleId: string;
  serviceId: string;
  currency: string;
  totalAmount: Prisma.Decimal;
  quoteFingerprint: string;
  requestFingerprint: string | null;
  reservations: { serviceDate: Date; dailyAmount: Prisma.Decimal; currency: string; priceSource: string; status: RentalHoldStatus; expiresAt: Date | null }[];
};

const GROUP_REPLAY_SELECT = {
  id: true,
  holdToken: true,
  rentalOfferingId: true,
  vehicleId: true,
  serviceId: true,
  currency: true,
  totalAmount: true,
  quoteFingerprint: true,
  requestFingerprint: true,
  reservations: { select: { serviceDate: true, dailyAmount: true, currency: true, priceSource: true, status: true, expiresAt: true } },
} as const;

/** Build the safe hold DTO from a persisted hold-group header + its child rows (for replay). */
function buildHoldFromGroup(group: GroupWithReservations, replayed: boolean): DailyRentalHold {
  const days: RentalHoldDay[] = group.reservations
    .map((r) => ({ dateKey: omanDateKeyFromDbDate(r.serviceDate), amount: r.dailyAmount.toFixed(2), currency: r.currency, priceSource: r.priceSource as RentalPriceSource }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const status = (group.reservations[0]?.status ?? "HELD") as RentalHoldStatus;
  const expiresAtDate = group.reservations[0]?.expiresAt ?? null;
  let lowest: Prisma.Decimal | null = null;
  for (const r of group.reservations) if (lowest === null || r.dailyAmount.lessThan(lowest)) lowest = r.dailyAmount;
  const quote: RentalHoldQuote = {
    offeringId: group.rentalOfferingId,
    vehicleId: group.vehicleId,
    serviceId: group.serviceId,
    currency: group.currency,
    dateKeys: days.map((d) => d.dateKey),
    days,
    chargeableDays: days.length,
    total: group.totalAmount.toFixed(2),
    lowestDailyRate: (lowest ?? group.totalAmount).toFixed(2),
    quoteFingerprint: group.quoteFingerprint,
  };
  return { holdGroupId: group.id, holdToken: group.holdToken, status, expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null, quote, replayed };
}

/** Look up an existing hold group for (customer, idempotencyKey). Groups are never deleted, so this
 *  returns keyed groups regardless of their current lifecycle state (stable historical replay). */
async function findGroupByKey(db: PrismaClient, customerId: string, idempotencyKey: string): Promise<GroupWithReservations | null> {
  return (await db.rentalVehicleDayHoldGroup.findUnique({
    where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
    select: GROUP_REPLAY_SELECT,
  })) as unknown as GroupWithReservations | null;
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

/** The authoritative in-transaction quote + eligibility resolution (no writes). */
type ResolvedAcquisition =
  | { ok: true; offering: LoadedOffering; vehicleId: string; quote: RentalHoldQuote; resolved: { dateKey: string; amount: Prisma.Decimal; priceSource: RentalPriceSource }[] }
  | { ok: false; reason: "NOT_BOOKABLE" | "CAPACITY_EXCEEDED" | "DAY_NOT_AVAILABLE" };

async function resolveAcquisition(
  tx: Prisma.TransactionClient,
  params: AcquireDailyRentalHoldParams,
  sortedKeys: string[],
  dbDates: Date[],
  now: Date,
): Promise<ResolvedAcquisition> {
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
  if (!offeringRow) return { ok: false, reason: "NOT_BOOKABLE" };
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

  if ((await assertRentalVerticalCompliant(tx, offering.providerId)) !== null) return { ok: false, reason: "NOT_BOOKABLE" };
  if (assertRentalVehicleReady(offering.vehicle, now) !== null) return { ok: false, reason: "NOT_BOOKABLE" };

  const cap = checkCapacityOverride(offering.vehicle.bookablePassengerCapacity, offering.offeringCapacityOverride);
  if (!cap.ok || cap.effectiveCapacity === null) return { ok: false, reason: "NOT_BOOKABLE" };
  if (params.passengerCount > cap.effectiveCapacity) return { ok: false, reason: "CAPACITY_EXCEEDED" };

  const base = parseOfferingAmount(offering.baseDailyAmount);
  if (base === null) return { ok: false, reason: "NOT_BOOKABLE" };

  const dayRows = (await tx.rentalOfferingDay.findMany({
    where: { rentalOfferingId: offering.id, serviceDate: { in: dbDates } },
    select: { serviceDate: true, state: true, dailyAmountOverride: true },
  })) as unknown as { serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[];
  const byKey = new Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>();
  for (const r of dayRows) byKey.set(omanDateKeyFromDbDate(r.serviceDate), { state: r.state, override: r.dailyAmountOverride });

  const resolved: { dateKey: string; amount: Prisma.Decimal; priceSource: RentalPriceSource }[] = [];
  for (const dateKey of sortedKeys) {
    const row = byKey.get(dateKey);
    if (!row || row.state !== "OPEN") return { ok: false, reason: "DAY_NOT_AVAILABLE" };
    if (row.override !== null) {
      const override = parseOfferingAmount(row.override);
      if (override === null) return { ok: false, reason: "DAY_NOT_AVAILABLE" }; // malformed → fail closed
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
  return { ok: true, offering, vehicleId, quote, resolved };
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
  const dbDates = sortedKeys.map((k) => dbDateFromOmanDateKey(k)!);
  const idempotencyKey = params.idempotencyKey ?? null;
  const requestFingerprint = computeRentalHoldRequestFingerprint({ offeringId: params.offeringId, dateKeys: sortedKeys, passengerCount: params.passengerCount });

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
    let phase: "group" | "children" | "audit" | null = null;
    try {
      // ---- Idempotency fast path: a keyed group already exists → replay it (same fingerprint) or
      // fail with a mismatch. Groups are never deleted, so this is a STABLE historical replay: a
      // replay after RELEASED/EXPIRED returns the original group and never creates a fresh hold. ----
      if (idempotencyKey !== null) {
        const existing = await findGroupByKey(prisma, params.customerId, idempotencyKey);
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) return { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
          return { ok: true, hold: buildHoldFromGroup(existing, true) };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        // Owner still exists (TOCTOU: could have been removed after the session was derived).
        const customer = await tx.customer.findUnique({ where: { id: params.customerId }, select: { id: true } });
        if (!customer) return { ok: false as const, reason: "NOT_BOOKABLE" as const };

        // Re-read + resolve offering/vertical/vehicle/capacity/days/prices (no writes on failure).
        const r = await resolveAcquisition(tx, params, sortedKeys, dbDates, now);
        if (!r.ok) return { ok: false as const, reason: r.reason };
        const { offering, vehicleId, quote, resolved } = r;

        // Price-drift: recomputed authoritative quote vs the client's expected quote. No write.
        const expected = params.expectedQuote ?? null;
        if (expected !== null) {
          const fpMismatch = "fingerprint" in expected && expected.fingerprint !== quote.quoteFingerprint;
          const totalMismatch = "total" in expected && (expected.total !== quote.total || expected.currency !== quote.currency);
          if (fpMismatch || totalMismatch) return { ok: false as const, reason: "PRICE_CHANGED" as const, quote };
        }

        // 1) Claim the GROUP identity FIRST. Its UNIQUE(customerId, idempotencyKey) is the arbiter:
        //    two concurrent same-key requests serialize here; the loser's create throws P2002 and its
        //    whole transaction rolls back (no header, no children, no audit) → mapped below.
        const holdToken = randomBytes(24).toString("hex");
        const expiresAt = new Date(now.getTime() + RENTAL_HOLD_TTL_MINUTES * 60_000);
        phase = "group";
        const group = await tx.rentalVehicleDayHoldGroup.create({
          data: {
            holdToken,
            customerId: params.customerId,
            serviceId: offering.serviceId,
            rentalOfferingId: offering.id,
            vehicleId,
            passengerCount: params.passengerCount,
            idempotencyKey,
            requestFingerprint: idempotencyKey !== null ? requestFingerprint : null,
            quoteFingerprint: quote.quoteFingerprint,
            totalAmount: new Prisma.Decimal(quote.total),
            currency: quote.currency,
          },
          select: { id: true },
        });

        // 2) Expire stale HELD child rows for exactly the targeted vehicle/dates (frees lapsed
        //    inventory so the active partial-unique index does not reject a logically-expired hold).
        await expireStaleHoldsForVehicleDates(tx, vehicleId, dbDates, now);

        // 3) Insert every child day row atomically. A physical (vehicleId, serviceDate) conflict on
        //    ANY date aborts the whole INSERT → the transaction (header + children) rolls back.
        phase = "children";
        await tx.rentalVehicleDayReservation.createMany({
          data: resolved.map((day) => ({
            holdGroupId: group.id,
            vehicleId,
            serviceDate: dbDateFromOmanDateKey(day.dateKey)!,
            status: "HELD" as const,
            dailyAmount: day.amount,
            currency: quote.currency,
            priceSource: day.priceSource,
            expiresAt,
          })),
        });

        // 4) Success audit INSIDE the transaction (its failure rolls the whole hold back).
        phase = "audit";
        await tx.auditLog.create({
          data: {
            actorType: "CUSTOMER",
            actorId: params.customerId,
            action: "rental.daily_hold_acquired",
            entityType: "RentalVehicleDayHoldGroup",
            entityId: group.id,
            newValue: {
              holdGroupId: group.id,
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

        const hold: DailyRentalHold = { holdGroupId: group.id, holdToken, status: "HELD", expiresAt: expiresAt.toISOString(), quote, replayed: false };
        return { ok: true as const, hold };
      });

      return result;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A P2002 at the GROUP-claim phase is the idempotency arbiter firing (a concurrent same-key
        // request). At the CHILD phase our group already committed-in-tx, so it is a physical
        // vehicle/day collision (a keyless group can never hit the group unique — NULLs are distinct).
        if (phase === "group" && idempotencyKey !== null) {
          const existing = await findGroupByKey(prisma, params.customerId, idempotencyKey);
          if (existing) {
            return existing.requestFingerprint === requestFingerprint
              ? { ok: true, hold: buildHoldFromGroup(existing, true) }
              : { ok: false, reason: "IDEMPOTENCY_MISMATCH" };
          }
          continue; // competitor rolled back before committing → retry the whole flow (bounded)
        }
        // A physical vehicle/day conflict (child phase), or any keyless conflict.
        return { ok: false, reason: "VEHICLE_DATE_CONFLICT" };
      }
      logger.error("acquireDailyRentalHold.read_failed", {
        offeringId: params.offeringId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: "READ_FAILED" };
    }
  }
  // Bounded retries exhausted (repeated rollback race) — fail closed rather than loop unbounded.
  return { ok: false, reason: "VEHICLE_DATE_CONFLICT" };
}
