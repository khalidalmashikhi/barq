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

// Deterministic keyset page size for scanning PUBLISHED candidate offerings (ordered by unique id).
export const RENTAL_CALENDAR_PAGE_SIZE = 50;

// Two DISTINCT bounds with distinct meanings (no silent truncation of either):
//   • MAX_RENTAL_CALENDAR_OFFERINGS — the maximum number of ELIGIBLE offerings RETURNED in one
//     calendar response. One non-ARCHIVED offering exists per (serviceId, vehicleId), so this is the
//     fleet size; 100 is far beyond any real rental fleet. A 101st eligible offering is NEVER silently
//     omitted — it fails closed (ELIGIBLE_OFFERING_LIMIT_EXCEEDED), rather than a partial "complete" calendar.
//   • MAX_RENTAL_CALENDAR_CANDIDATES — the safety ceiling on candidate ROWS INSPECTED while scanning
//     for eligible offerings (protection against pathological data). Reaching it with more rows left
//     fails closed (CANDIDATE_LIMIT_EXCEEDED), never a misleading empty/partial calendar.
export const MAX_RENTAL_CALENDAR_OFFERINGS = 100;
export const MAX_RENTAL_CALENDAR_CANDIDATES = 1000;

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
  /**
   * SERVICE-WIDE (complete) lowest REAL daily rate across AVAILABLE days of ALL returned eligible
   * offerings, in the single common currency (null when offerings mix currencies or none is
   * available); never invented. Because a calendar is returned ONLY when the FULL eligible set fit
   * within the response bound (a 101st eligible offering fails closed instead), this value is the
   * complete Service-wide minimum, never computed from a silently-truncated candidate set.
   */
  lowestAvailableDailyRate: RentalCalendarMoney | null;
  /** CONFIGURED availability only — final vehicle-reservation revalidation is a C3/E dependency. */
  availabilityBasis: "CONFIGURED";
};

export type ResolveRentalServiceCalendarResult =
  | { ok: true; calendar: RentalServiceCalendar }
  // NOT_PUBLIC/INVALID_WINDOW/READ_FAILED map to 404/400/500; the two *_LIMIT_EXCEEDED overflow
  // reasons map to a safe generic public error (never revealing fleet/provider state).
  | { ok: false; reason: "NOT_PUBLIC" | "INVALID_WINDOW" | "READ_FAILED" | "CANDIDATE_LIMIT_EXCEEDED" | "ELIGIBLE_OFFERING_LIMIT_EXCEEDED" };

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

/** A candidate that passed candidate-LOCAL readiness (vehicle selectable + verified capacity + valid base money/currency). */
type EligibleEntry = { row: CandidateRow; base: Prisma.Decimal; currency: string; effectiveCapacity: number };

/**
 * Candidate-LOCAL readiness, evaluated in memory (no query): vehicle selectable + verified capacity +
 * valid base money/currency. Returns the eligible entry or null — a failure disqualifies ONLY this
 * offering and never hides a valid later one.
 */
function toEligibleEntry(c: CandidateRow, now: Date): EligibleEntry | null {
  if (assertRentalVehicleReady(c.vehicle, now) !== null) return null;
  const base = parseOfferingAmount(c.baseDailyAmount);
  const currency = normalizeOfferingCurrency(c.currency);
  const cap = checkCapacityOverride(c.vehicle.bookablePassengerCapacity, c.offeringCapacityOverride);
  if (base === null || currency === null || !cap.ok || cap.effectiveCapacity === null) return null;
  return { row: c, base, currency, effectiveCapacity: cap.effectiveCapacity };
}

/** Build one eligible offering's per-date calendar over the window from its OPEN/BLOCKED day rows. */
function buildOffering(
  entry: EligibleEntry,
  dateKeys: string[],
  dayByKey: Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>,
  now: Date,
): RentalCalendarOffering {
  const currency = entry.currency;
  const days: RentalCalendarDay[] = dateKeys.map((dateKey) => {
    // Past Oman dates are never selectable, regardless of configured state.
    const past = isOmanPastDateKey(dateKey, now);
    const row = dayByKey.get(`${entry.row.id}|${dateKey}`);
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
    return { dateKey, dayState: "OPEN", available: true, unavailableReason: null, dailyPrice: { amount: entry.base.toFixed(2), currency }, priceSource: "BASE" };
  });

  return {
    offeringId: entry.row.id,
    vehicle: {
      id: entry.row.vehicle.assetId,
      make: entry.row.vehicle.make,
      model: entry.row.vehicle.model,
      modelYear: entry.row.vehicle.modelYear,
      color: entry.row.vehicle.color,
      vehicleType: entry.row.vehicle.vehicleType,
      bookablePassengerCapacity: entry.effectiveCapacity,
    },
    baseDailyRate: { amount: entry.base.toFixed(2), currency },
    days,
  };
}

/**
 * Assemble the final calendar from all returned eligible offerings. The lowest rate is SERVICE-WIDE
 * (complete): it is only ever built when the whole eligible set fit within the response bound, so it
 * is never computed from a truncated set. Mixed currencies fail closed (currency + lowest null) —
 * mixed currencies are NEVER compared numerically.
 */
function buildCalendar(serviceId: string, window: { from: string; to: string }, offerings: RentalCalendarOffering[]): RentalServiceCalendar {
  const distinctCurrencies = [...new Set(offerings.map((o) => o.baseDailyRate.currency))];
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
    serviceId,
    currency: commonCurrency,
    window: { from: window.from, to: window.to, timeZone: OMAN_TIME_ZONE },
    offerings,
    lowestAvailableDailyRate: lowest,
    availabilityBasis: "CONFIGURED",
  };
}

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

    // ---- Deterministic KEYSET scan of PUBLISHED candidate offerings (order by unique id, id > cursor,
    // page size 50). Provider/service scope is re-applied on EVERY page; NO offset/skip; NO start-times.
    // Candidate-LOCAL readiness is filtered in memory; each page with ≥1 ready candidate runs ONE
    // windowed day query. Two bounds guard the scan (see the constants): the eligible-response bound
    // (a 101st eligible offering fails closed, never silently omitted) and the inspected-candidate
    // ceiling (reaching it with more rows left fails closed, never a partial "complete" calendar). ----
    const baseWhere = {
      serviceId: params.serviceId,
      status: "PUBLISHED" as const,
      vehicle: { asset: { providerId: service.providerId, assetType: "VEHICLE" as const } },
    };
    const dbFrom = dbDateFromOmanDateKey(window.from)!;
    const dbTo = dbDateFromOmanDateKey(window.to)!;
    const offerings: RentalCalendarOffering[] = [];
    let cursor: string | null = null;
    let inspected = 0;

    while (inspected < MAX_RENTAL_CALENDAR_CANDIDATES) {
      const take = Math.min(RENTAL_CALENDAR_PAGE_SIZE, MAX_RENTAL_CALENDAR_CANDIDATES - inspected);
      const page = (await db.rentalOffering.findMany({
        where: cursor === null ? baseWhere : { ...baseWhere, id: { gt: cursor } },
        select: {
          id: true,
          baseDailyAmount: true,
          currency: true,
          offeringCapacityOverride: true,
          vehicle: { select: CANDIDATE_VEHICLE_SELECT },
        },
        orderBy: { id: "asc" },
        take,
      })) as unknown as CandidateRow[];
      if (page.length === 0) return { ok: true, calendar: buildCalendar(params.serviceId, window, offerings) }; // exhausted

      const ready = page.map((c) => toEligibleEntry(c, now)).filter((x): x is EligibleEntry => x !== null);
      if (ready.length > 0) {
        // ONE batched windowed day query for THIS page's ready offerings (no query for a page with
        // zero ready candidates; serviceDate gte/lte; no start-times; no unbounded history).
        const dayRows = (await db.rentalOfferingDay.findMany({
          where: { rentalOfferingId: { in: ready.map((e) => e.row.id) }, serviceDate: { gte: dbFrom, lte: dbTo } },
          select: { rentalOfferingId: true, serviceDate: true, state: true, dailyAmountOverride: true },
        })) as unknown as { rentalOfferingId: string; serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[];
        const dayByKey = new Map<string, { state: "OPEN" | "BLOCKED"; override: Prisma.Decimal | null }>();
        for (const r of dayRows) dayByKey.set(`${r.rentalOfferingId}|${omanDateKeyFromDbDate(r.serviceDate)}`, { state: r.state, override: r.dailyAmountOverride });

        for (const e of ready) {
          offerings.push(buildOffering(e, dateKeys, dayByKey, now));
          // One eligible past the response bound is the overflow WITNESS: fail closed rather than
          // silently omit it (and never present a truncated set as a complete calendar).
          if (offerings.length > MAX_RENTAL_CALENDAR_OFFERINGS) {
            logger.warn("resolveRentalServiceCalendar.eligible_offering_limit_exceeded", { serviceId: params.serviceId, eligible: offerings.length });
            return { ok: false, reason: "ELIGIBLE_OFFERING_LIMIT_EXCEEDED" };
          }
        }
      }

      inspected += page.length;
      cursor = page[page.length - 1]!.id;
      if (page.length < take) return { ok: true, calendar: buildCalendar(params.serviceId, window, offerings) }; // partial page ⇒ exhausted (no overflow probe)
    }

    // Reached the inspected-candidate ceiling. If NO further candidate exists, the full set was scanned
    // → return the calendar. If one remains, fail closed (never a misleading empty/partial calendar).
    const more = await db.rentalOffering.findFirst({ where: { ...baseWhere, id: { gt: cursor! } }, select: { id: true }, orderBy: { id: "asc" } });
    if (!more) return { ok: true, calendar: buildCalendar(params.serviceId, window, offerings) };
    logger.warn("resolveRentalServiceCalendar.candidate_limit_exceeded", { serviceId: params.serviceId, inspected });
    return { ok: false, reason: "CANDIDATE_LIMIT_EXCEEDED" };
  } catch (error) {
    logger.error("resolveRentalServiceCalendar.read_failed", {
      serviceId: params.serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "READ_FAILED" };
  }
}
