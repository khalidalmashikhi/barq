import "server-only";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  parseOmanDateKey,
  omanDateKey,
  isOmanPastDateKey,
  dbDateFromOmanDateKey,
  omanDateKeyFromDbDate,
} from "@/lib/date/oman-time";
import {
  MAX_CALENDAR_WINDOW_DAYS,
  DEFAULT_CALENDAR_WINDOW_DAYS,
  calendarWindowInclusiveDays,
  type OfferingDayState,
  type UnavailableReason,
} from "@/lib/offerings/calendar/offering-calendar-types";
import {
  assertRentalVerticalCompliant,
  assertRentalVehicleReady,
  type DbClient,
  type LoadedRentalVehicle,
} from "./rental-offering-authorization";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";

// Phase 3C Slice C2c — the PURE, server-side PUBLIC rental-calendar resolver: given a publicly
// visible VEHICLE_RENTAL Service and a strict Oman date window, resolve each eligible published
// offering's per-date CONFIGURED availability + authoritative daily price. READ-ONLY: no booking,
// reservation, hold, offering/day/start-time write, or audit event. It reuses the C2a Oman-date +
// calendar contract, the C2b-R/C2b-R2 vertical/vehicle readiness authorities, and the pure money
// validators — it duplicates NO legal-vertical or vehicle-readiness logic and reads NO legacy Price
// row for pricing. Guided offering tables/logic are never touched.
//
// AVAILABILITY MEANING AT C2c: "available" here is CONFIGURED availability only (an explicit OPEN,
// non-past day with an authoritative price on a currently-eligible published offering). It is NOT a
// reservation guarantee: there is no daily-rental reservation-conflict authority yet (the existing
// VehicleReservation path is the legacy interval-booking write path, not a public daily reader), so
// this resolver never emits VEHICLE_CONFLICT and never claims final bookability. C3/E must revalidate
// vehicle-reservation conflicts atomically before any booking — see `availabilityBasis: "CONFIGURED"`.

// A defensive upper bound on offerings surfaced for one Service (one non-ARCHIVED offering per
// (serviceId, vehicleId) ⇒ this is the fleet size; 100 is far beyond any real rental fleet and keeps
// the day query bounded at offerings × window).
export const MAX_RENTAL_CALENDAR_OFFERINGS = 100;

const RENTAL_OFFERING_KIND = "VEHICLE_RENTAL" as const;
const OMAN_TIME_ZONE = "Asia/Muscat" as const;

export type RentalCalendarMoney = { amount: string; currency: string };

export type RentalCalendarDay = {
  dateKey: string;
  dayState: OfferingDayState; // OPEN | BLOCKED | NONE (configured)
  available: boolean; // CONFIGURED availability (not reservation-confirmed)
  unavailableReason: UnavailableReason | null;
  dailyPrice: RentalCalendarMoney | null; // non-null ONLY when available
  priceSource: "BASE" | "OVERRIDE" | null;
};

export type RentalCalendarVehicle = {
  id: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  /** Effective customer party-size ceiling (override ?? verified). Capacity metadata, never inventory. */
  bookablePassengerCapacity: number;
};

export type RentalCalendarOffering = {
  offeringId: string;
  vehicle: RentalCalendarVehicle;
  baseDailyRate: RentalCalendarMoney;
  days: RentalCalendarDay[];
};

export type RentalServiceCalendar = {
  serviceId: string;
  /** The single common offering currency, or null when offerings mix currencies (aggregate fails closed). */
  currency: string | null;
  window: { from: string; to: string; timeZone: typeof OMAN_TIME_ZONE };
  offerings: RentalCalendarOffering[];
  /** Lowest REAL daily rate across AVAILABLE days (single common currency only); never invented. */
  lowestAvailableDailyRate: RentalCalendarMoney | null;
  /** CONFIGURED availability only — final vehicle-reservation revalidation is a C3/E dependency. */
  availabilityBasis: "CONFIGURED";
};

export type ResolveRentalServiceCalendarResult =
  | { ok: true; calendar: RentalServiceCalendar }
  | { ok: false; reason: "NOT_PUBLIC" | "INVALID_WINDOW" | "READ_FAILED" };

const CANDIDATE_VEHICLE_SELECT = {
  assetId: true,
  bookablePassengerCapacity: true,
  make: true,
  model: true,
  modelYear: true,
  color: true,
  vehicleType: true,
  asset: {
    select: {
      providerId: true,
      assetType: true,
      status: true,
      verificationStatus: true,
      documents: { select: { type: true, status: true, expiresAt: true } },
    },
  },
} as const;

type CandidateRow = {
  id: string;
  baseDailyAmount: Prisma.Decimal;
  currency: string;
  offeringCapacityOverride: number | null;
  vehicle: LoadedRentalVehicle & {
    make: string | null;
    model: string | null;
    modelYear: number | null;
    color: string | null;
    vehicleType: string | null;
  };
};

/** Build the inclusive list of Oman date keys for [fromKey, toKey] (both already validated). */
function dateKeysInWindow(fromKey: string, toKey: string): string[] {
  const days = calendarWindowInclusiveDays(fromKey, toKey);
  if (days === null) return [];
  const keys: string[] = [];
  const [y, m, d] = fromKey.split("-").map(Number);
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i));
    keys.push(omanDateKeyFromDbDate(dt));
  }
  return keys;
}

/**
 * Resolve/validate the requested Oman date window. Both keys given → strict YYYY-MM-DD, from <= to,
 * <= MAX_CALENDAR_WINDOW_DAYS. Neither given → the default window (today .. today + DEFAULT-1). Exactly
 * one given → invalid (no silent half-window). No JS-local interpretation; no rollover.
 */
function resolveWindow(from: string | undefined, to: string | undefined, now: Date): { from: string; to: string } | null {
  if (from === undefined && to === undefined) {
    const start = omanDateKey(now);
    const [y, m, d] = start.split("-").map(Number);
    const end = omanDateKeyFromDbDate(new Date(Date.UTC(y!, m! - 1, d! + (DEFAULT_CALENDAR_WINDOW_DAYS - 1))));
    return { from: start, to: end };
  }
  if (from === undefined || to === undefined) return null;
  const f = parseOmanDateKey(from);
  const t = parseOmanDateKey(to);
  if (f === null || t === null) return null;
  const span = calendarWindowInclusiveDays(f, t); // null when from > to
  if (span === null || span > MAX_CALENDAR_WINDOW_DAYS) return null;
  return { from: f, to: t };
}

export async function resolveRentalServiceCalendar(
  db: DbClient,
  params: { serviceId: string; from?: string; to?: string; now?: Date },
): Promise<ResolveRentalServiceCalendarResult> {
  const now = params.now ?? new Date();

  const window = resolveWindow(params.from, params.to, now);
  if (window === null) return { ok: false, reason: "INVALID_WINDOW" };

  try {
    // ---- GLOBAL public-visibility gate: PUBLISHED Service + APPROVED, visible provider (mirrors
    // getServiceById's public predicate) + VEHICLE_RENTAL kind. Anything else → uniform NOT_PUBLIC. ----
    const service = await db.service.findFirst({
      where: { id: params.serviceId, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
      select: { providerId: true, offeringKind: true },
    });
    if (!service || service.offeringKind !== RENTAL_OFFERING_KIND) return { ok: false, reason: "NOT_PUBLIC" };

    const dateKeys = dateKeysInWindow(window.from, window.to);
    const emptyCalendar: RentalServiceCalendar = {
      serviceId: params.serviceId,
      currency: null,
      window: { from: window.from, to: window.to, timeZone: OMAN_TIME_ZONE },
      offerings: [],
      lowestAvailableDailyRate: null,
      availabilityBasis: "CONFIGURED",
    };

    // Provider-GLOBAL RENTAL_COMPANY vertical compliance, evaluated ONCE on this db client. Failure ⇒
    // fail closed to an EMPTY public calendar (never revealing the cause).
    if ((await assertRentalVerticalCompliant(db, service.providerId)) !== null) return { ok: true, calendar: emptyCalendar };

    // Candidate PUBLISHED offerings for THIS service whose Vehicle the SAME provider owns (foreign
    // vehicle/offering cannot match). Bounded + deterministically ordered; no start-times loaded.
    const candidates = (await db.rentalOffering.findMany({
      where: {
        serviceId: params.serviceId,
        status: "PUBLISHED",
        vehicle: { asset: { providerId: service.providerId, assetType: "VEHICLE" } },
      },
      select: {
        id: true,
        baseDailyAmount: true,
        currency: true,
        offeringCapacityOverride: true,
        vehicle: { select: CANDIDATE_VEHICLE_SELECT },
      },
      orderBy: { id: "asc" },
      take: MAX_RENTAL_CALENDAR_OFFERINGS,
    })) as unknown as CandidateRow[];

    // Candidate-LOCAL readiness (in memory): vehicle selectable + verified capacity + valid base
    // money/currency. A failure disqualifies ONLY that offering (never hides another valid one).
    const eligible = candidates
      .map((c) => {
        if (assertRentalVehicleReady(c.vehicle, now) !== null) return null;
        const base = parseOfferingAmount(c.baseDailyAmount);
        const currency = normalizeOfferingCurrency(c.currency);
        const cap = checkCapacityOverride(c.vehicle.bookablePassengerCapacity, c.offeringCapacityOverride);
        if (base === null || currency === null || !cap.ok || cap.effectiveCapacity === null) return null;
        return { row: c, base, currency, effectiveCapacity: cap.effectiveCapacity };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (eligible.length === 0) return { ok: true, calendar: emptyCalendar };

    // One bounded day query for ALL eligible offerings within the window (offerings × ≤62 rows). No
    // start-time rows; no unbounded history.
    const dayRows = (await db.rentalOfferingDay.findMany({
      where: {
        rentalOfferingId: { in: eligible.map((e) => e.row.id) },
        serviceDate: { gte: dbDateFromOmanDateKey(window.from)!, lte: dbDateFromOmanDateKey(window.to)! },
      },
      select: { rentalOfferingId: true, serviceDate: true, state: true, dailyAmountOverride: true },
    })) as unknown as { rentalOfferingId: string; serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[];

    const dayByKey = new Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>();
    for (const r of dayRows) {
      dayByKey.set(`${r.rentalOfferingId}|${omanDateKeyFromDbDate(r.serviceDate)}`, { state: r.state, override: r.dailyAmountOverride });
    }

    const offerings: RentalCalendarOffering[] = eligible.map((e) => {
      const currency = e.currency;
      const days: RentalCalendarDay[] = dateKeys.map((dateKey) => {
        // Past Oman dates are never selectable, regardless of configured state.
        const past = isOmanPastDateKey(dateKey, now);
        const row = dayByKey.get(`${e.row.id}|${dateKey}`);
        const dayState: OfferingDayState = row ? row.state : "NONE";

        if (past) return { dateKey, dayState, available: false, unavailableReason: "PAST", dailyPrice: null, priceSource: null };
        if (!row) return { dateKey, dayState: "NONE", available: false, unavailableReason: "NO_OPEN_DAY", dailyPrice: null, priceSource: null };
        if (row.state === "BLOCKED") return { dateKey, dayState: "BLOCKED", available: false, unavailableReason: "BLOCKED", dailyPrice: null, priceSource: null };

        // OPEN: override wins when present; a MALFORMED override fails CLOSED for this day (never a
        // silent fallback to base). Absent override ⇒ the offering base.
        if (row.override !== null) {
          const override = parseOfferingAmount(row.override);
          if (override === null) return { dateKey, dayState: "OPEN", available: false, unavailableReason: "NO_PRICE", dailyPrice: null, priceSource: null };
          return { dateKey, dayState: "OPEN", available: true, unavailableReason: null, dailyPrice: { amount: override.toFixed(2), currency }, priceSource: "OVERRIDE" };
        }
        return { dateKey, dayState: "OPEN", available: true, unavailableReason: null, dailyPrice: { amount: e.base.toFixed(2), currency }, priceSource: "BASE" };
      });

      return {
        offeringId: e.row.id,
        vehicle: {
          id: e.row.vehicle.assetId,
          make: e.row.vehicle.make,
          model: e.row.vehicle.model,
          modelYear: e.row.vehicle.modelYear,
          color: e.row.vehicle.color,
          vehicleType: e.row.vehicle.vehicleType,
          bookablePassengerCapacity: e.effectiveCapacity,
        },
        baseDailyRate: { amount: e.base.toFixed(2), currency },
        days,
      };
    });

    // Service currency + lowest aggregate: only when all eligible offerings share ONE currency; mixed
    // currencies fail closed (currency null, lowest null) — never compare mixed currencies numerically.
    const distinctCurrencies = [...new Set(eligible.map((e) => e.currency))];
    const commonCurrency = distinctCurrencies.length === 1 ? distinctCurrencies[0]! : null;
    let lowest: RentalCalendarMoney | null = null;
    if (commonCurrency !== null) {
      let min: Prisma.Decimal | null = null;
      for (const off of offerings) {
        for (const day of off.days) {
          if (!day.available || day.dailyPrice === null) continue;
          const amt = parseOfferingAmount(day.dailyPrice.amount);
          if (amt === null) continue;
          if (min === null || amt.lessThan(min)) min = amt;
        }
      }
      if (min !== null) lowest = { amount: min.toFixed(2), currency: commonCurrency };
    }

    return {
      ok: true,
      calendar: {
        serviceId: params.serviceId,
        currency: commonCurrency,
        window: { from: window.from, to: window.to, timeZone: OMAN_TIME_ZONE },
        offerings,
        lowestAvailableDailyRate: lowest,
        availabilityBasis: "CONFIGURED",
      },
    };
  } catch (error) {
    logger.error("resolveRentalServiceCalendar.read_failed", {
      serviceId: params.serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "READ_FAILED" };
  }
}
