import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

// Phase 3C Slice C3/E1 — shared contract for the daily-rental vehicle/day reservation authority:
// constants, safe DTOs, the stable failure vocabulary, and the deterministic request/quote
// fingerprints. NO I/O here. Money is Prisma.Decimal / 2dp everywhere (never JS float); passenger
// count is capacity-only and NEVER a price factor. This authority is SEPARATE from the guided-tour
// tables and from the legacy interval VehicleReservation, and reads NO legacy Price row.

export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Server-owned temporary-hold TTL. A HELD reservation blocks its vehicle/day for exactly this long,
 * after which it is EXPIRABLE (explicitly, never by a DB NOW() predicate). Chosen to comfortably
 * cover a customer completing selection → checkout without holding inventory indefinitely; the
 * repository has no shorter reservation-timeout convention to inherit. Client input NEVER sets expiry.
 */
export const RENTAL_HOLD_TTL_MINUTES = 10;

/**
 * The maximum number of distinct Oman days one acquisition may hold at once — the same inclusive
 * bound as a calendar window (MAX_CALENDAR_WINDOW_DAYS). A larger selection fails closed rather than
 * fanning out an unbounded multi-row insert.
 */
export const MAX_RENTAL_HOLD_DATES = 62;

/** The two authoritative price sources for a day's rate (override wins over the offering base). */
export type RentalPriceSource = "BASE" | "OVERRIDE";

/** One selected day's authoritative price snapshot (safe DTO). */
export type RentalHoldDay = {
  dateKey: string;
  amount: string; // 2dp string
  currency: string;
  priceSource: RentalPriceSource;
};

/**
 * The authoritative server quote for a selected set of days — recomputed immediately before any
 * write, and the value returned to the caller both on success and on PRICE_CHANGED so a later
 * confirmation can use the current truth. Contains NO customer identity, booking id, or hold token.
 */
export type RentalHoldQuote = {
  offeringId: string;
  vehicleId: string;
  serviceId: string;
  currency: string;
  /** Sorted, unique selected Oman day keys. */
  dateKeys: string[];
  /** Per-date resolved rate, sorted. */
  days: RentalHoldDay[];
  /** Number of chargeable days ( = dateKeys.length; each date charged exactly once). */
  chargeableDays: number;
  /** Exact Decimal sum of the daily rates, 2dp string. Passenger count never affects it. */
  total: string;
  /** Lowest selected daily rate, 2dp string. */
  lowestDailyRate: string;
  /** Deterministic fingerprint of the normalized server-owned quote (for price-drift detection). */
  quoteFingerprint: string;
};

/** The safe hold DTO returned on a successful (or replayed) acquisition. No other customer's data. */
export type DailyRentalHold = {
  holdGroupId: string;
  holdToken: string;
  status: "HELD";
  /** Absolute expiry instant (ISO) — server-owned; the hold blocks until then. */
  expiresAt: string;
  quote: RentalHoldQuote;
  /** True when this result replays an existing idempotent hold rather than creating a new one. */
  replayed: boolean;
};

/**
 * Stable, locale-neutral failure vocabulary. Non-enumerating: a not-public service, an ineligible
 * offering, an unready vehicle, and a non-compliant vertical all collapse to NOT_BOOKABLE (the cause
 * is never revealed). Raw Prisma/Postgres errors never leak.
 */
export type AcquireDailyRentalHoldFailure =
  | "INVALID_SELECTION" // empty / duplicate / malformed / past date, or more than MAX_RENTAL_HOLD_DATES
  | "INVALID_PASSENGER_COUNT" // not a positive integer
  | "CAPACITY_EXCEEDED" // passenger count above the verified effective bookable capacity
  | "NOT_BOOKABLE" // service not public / offering ineligible / vehicle unready / vertical non-compliant
  | "DAY_NOT_AVAILABLE" // a selected day is not an explicit OPEN day with a resolvable price
  | "PRICE_CHANGED" // the current authoritative quote differs from the client's expected quote
  | "VEHICLE_DATE_CONFLICT" // a selected vehicle/day is already actively held/confirmed (DB arbiter)
  | "IDEMPOTENCY_MISMATCH" // same idempotency key reused for a materially different request
  | "READ_FAILED"; // unexpected read/transaction failure (fail closed)

export type AcquireDailyRentalHoldResult =
  | { ok: true; hold: DailyRentalHold }
  // PRICE_CHANGED carries the fresh authoritative quote (no hold written); other failures carry none.
  | { ok: false; reason: AcquireDailyRentalHoldFailure; quote?: RentalHoldQuote };

/** The optional client-supplied expected quote, used ONLY for price-drift detection. */
export type ExpectedQuote =
  | { fingerprint: string }
  | { total: string; currency: string }
  | { fingerprint: string; total: string; currency: string };

/**
 * Deterministic fingerprint of a logical hold REQUEST (its identity for idempotency): the offering +
 * the sorted unique selected days + the passenger count. Mirrors computeBookingRequestFingerprint:
 * SHA-256 hex over a fixed-order, versioned, delimiter-safe JSON tuple. The expected quote is NOT
 * part of request identity (it is drift-detection only); customerId is the lookup scope, not the
 * fingerprint. Same key + same fingerprint → replay; same key + different fingerprint → mismatch.
 */
export function computeRentalHoldRequestFingerprint(input: {
  offeringId: string;
  dateKeys: string[]; // already sorted + unique
  passengerCount: number;
}): string {
  const canonical = JSON.stringify(["rental-hold-v1", input.offeringId, input.dateKeys, input.passengerCount]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Deterministic fingerprint of the authoritative server QUOTE (for price-drift detection): the
 * offering + sorted days + each day's resolved amount/source + currency + total. Any change to a
 * resolved daily rate, the day set, or the currency changes this hash.
 */
export function computeRentalHoldQuoteFingerprint(input: {
  offeringId: string;
  currency: string;
  total: string;
  days: RentalHoldDay[];
}): string {
  const canonical = JSON.stringify([
    "rental-quote-v1",
    input.offeringId,
    input.currency,
    input.total,
    input.days.map((d) => [d.dateKey, d.amount, d.priceSource]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
