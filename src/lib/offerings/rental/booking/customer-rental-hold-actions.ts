import "server-only";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { isValidIdempotencyKey } from "@/lib/booking/idempotency";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import { getRentalHoldRateLimit } from "@/lib/rate-limit/rate-limit-config";
import { logger } from "@/lib/logger";
import { acquireDailyRentalHold } from "../reservation/acquire-daily-rental-hold";
import { releaseDailyRentalHold } from "../reservation/release-daily-rental-hold";
import type { ExpectedQuote, RentalHoldQuote } from "../reservation/reservation-types";
import { confirmDailyRentalHoldAndCreateBooking, type RentalBookingSnapshot } from "./confirm-daily-rental-hold";

// Phase 3C Slice C3/E2 — the CUSTOMER-facing adapters between the thin API routes and the server
// authorities. Each: derives the customer from the session (requireCustomer — NEVER from client
// input), REQUIRES a valid idempotency key (business rule 15), rate-limits per customer, then calls
// the underlying authority. Business logic is NEVER duplicated here; this layer is auth + validation
// + rate-limit + a SAFE DTO. Stable error codes map 1:1 to the API envelope.

export type RentalHoldErrorCode =
  | "UNAUTHENTICATED"
  | "NO_CUSTOMER"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_MISMATCH"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "NOT_BOOKABLE"
  | "DAY_NOT_AVAILABLE"
  | "CAPACITY_EXCEEDED"
  | "PRICE_CHANGED"
  | "VEHICLE_DATE_CONFLICT"
  | "HOLD_NOT_FOUND"
  | "HOLD_EXPIRED"
  | "HOLD_NOT_CONFIRMABLE"
  | "READ_FAILED";

/** Customer-safe hold DTO — public identifiers + the quote only. No customer/provider ids, no
 *  compliance/audit/reservation-row internals, no requestFingerprint. */
export type RentalHoldDTO = {
  holdId: string;
  holdToken: string;
  status: string;
  expiresAt: string | null;
  serviceId: string;
  offeringId: string;
  vehicleId: string;
  passengerCount: number;
  dateKeys: string[];
  perDate: { dateKey: string; amount: string; currency: string; source: string }[];
  total: string;
  currency: string;
  quoteFingerprint: string;
  replayed: boolean;
};

function holdDTO(hold: { holdGroupId: string; holdToken: string; status: string; expiresAt: string | null; quote: RentalHoldQuote; replayed: boolean }, passengerCount: number): RentalHoldDTO {
  return {
    holdId: hold.holdGroupId,
    holdToken: hold.holdToken,
    status: hold.status,
    expiresAt: hold.expiresAt,
    serviceId: hold.quote.serviceId,
    offeringId: hold.quote.offeringId,
    vehicleId: hold.quote.vehicleId,
    passengerCount,
    dateKeys: hold.quote.dateKeys,
    perDate: hold.quote.days.map((d) => ({ dateKey: d.dateKey, amount: d.amount, currency: d.currency, source: d.priceSource })),
    total: hold.quote.total,
    currency: hold.quote.currency,
    quoteFingerprint: hold.quote.quoteFingerprint,
    replayed: hold.replayed,
  };
}

/** Resolve the session customer; maps auth exceptions to result codes (never leaks). */
async function resolveCustomer(): Promise<{ ok: true; customerId: string } | { ok: false; error: "UNAUTHENTICATED" | "NO_CUSTOMER" }> {
  try {
    const { customer } = await requireCustomer();
    return { ok: true, customerId: customer.id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, error: "UNAUTHENTICATED" };
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_CUSTOMER" };
    throw error;
  }
}

function rateLimited(customerId: string): boolean {
  return !checkRateLimit(`rental-hold:${customerId}`, getRentalHoldRateLimit()).allowed;
}

export type AcquireRentalHoldInput = {
  offeringId: unknown;
  dateKeys: unknown;
  passengerCount: unknown;
  idempotencyKey: string | null;
  expectedQuote?: ExpectedQuote | null;
};

export type AcquireRentalHoldActionResult =
  | { ok: true; hold: RentalHoldDTO }
  | { ok: false; error: RentalHoldErrorCode; quote?: RentalHoldQuote };

export async function acquireRentalHoldForCustomer(input: AcquireRentalHoldInput): Promise<AcquireRentalHoldActionResult> {
  const auth = await resolveCustomer();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, error: "IDEMPOTENCY_KEY_INVALID" };
  if (typeof input.offeringId !== "string" || !isValidUuid(input.offeringId)) return { ok: false, error: "INVALID_INPUT" };
  if (!Array.isArray(input.dateKeys) || !input.dateKeys.every((d) => typeof d === "string")) return { ok: false, error: "INVALID_INPUT" };
  if (typeof input.passengerCount !== "number" || !Number.isInteger(input.passengerCount)) return { ok: false, error: "INVALID_INPUT" };
  if (rateLimited(auth.customerId)) return { ok: false, error: "RATE_LIMITED" };

  const res = await acquireDailyRentalHold(prisma, {
    customerId: auth.customerId,
    offeringId: input.offeringId,
    dateKeys: input.dateKeys as string[],
    passengerCount: input.passengerCount,
    idempotencyKey: input.idempotencyKey,
    expectedQuote: input.expectedQuote ?? null,
  });
  if (res.ok) return { ok: true, hold: holdDTO(res.hold, input.passengerCount) };
  switch (res.reason) {
    case "INVALID_SELECTION":
    case "INVALID_PASSENGER_COUNT":
      return { ok: false, error: "INVALID_INPUT" };
    case "PRICE_CHANGED":
      return { ok: false, error: "PRICE_CHANGED", quote: res.quote };
    default:
      return { ok: false, error: res.reason };
  }
}

export type ReleaseRentalHoldActionResult =
  | { ok: true; releasedCount: number }
  | { ok: false; error: RentalHoldErrorCode };

export async function releaseRentalHoldForCustomer(input: { holdId: unknown; idempotencyKey: string | null }): Promise<ReleaseRentalHoldActionResult> {
  const auth = await resolveCustomer();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, error: "IDEMPOTENCY_KEY_INVALID" };
  if (typeof input.holdId !== "string" || !isValidUuid(input.holdId)) return { ok: false, error: "INVALID_INPUT" };
  if (rateLimited(auth.customerId)) return { ok: false, error: "RATE_LIMITED" };

  const res = await releaseDailyRentalHold(prisma, { holdGroupId: input.holdId, customerId: auth.customerId });
  if (res.ok) return { ok: true, releasedCount: res.releasedCount };
  return { ok: false, error: res.reason === "NOT_FOUND" ? "HOLD_NOT_FOUND" : "READ_FAILED" };
}

export type ConfirmRentalHoldActionResult =
  | { ok: true; booking: { id: string; status: string; rentalSnapshot: RentalBookingSnapshot }; replayed: boolean }
  | { ok: false; error: RentalHoldErrorCode; quote?: RentalHoldQuote };

export async function confirmRentalHoldForCustomer(input: {
  holdId: unknown;
  idempotencyKey: string | null;
  expectedQuote: ExpectedQuote | null;
}): Promise<ConfirmRentalHoldActionResult> {
  const auth = await resolveCustomer();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!isValidIdempotencyKey(input.idempotencyKey)) return { ok: false, error: "IDEMPOTENCY_KEY_INVALID" };
  if (typeof input.holdId !== "string" || !isValidUuid(input.holdId)) return { ok: false, error: "INVALID_INPUT" };
  if (input.expectedQuote === null || typeof input.expectedQuote !== "object") return { ok: false, error: "INVALID_INPUT" };
  if (rateLimited(auth.customerId)) return { ok: false, error: "RATE_LIMITED" };

  const res = await confirmDailyRentalHoldAndCreateBooking(prisma, {
    customerId: auth.customerId,
    holdGroupId: input.holdId,
    confirmationIdempotencyKey: input.idempotencyKey,
    expectedQuote: input.expectedQuote,
  });
  if (res.ok) return { ok: true, booking: res.booking, replayed: res.replayed };
  if (res.reason === "PRICE_CHANGED") return { ok: false, error: "PRICE_CHANGED", quote: res.quote };
  return { ok: false, error: res.reason };
}

export function logRentalHoldFailure(scope: string, error: RentalHoldErrorCode): void {
  if (error === "READ_FAILED") logger.error(`rentalHold.${scope}.read_failed`, {});
}

/**
 * Parse a client-supplied expected-quote object into a typed ExpectedQuote, or null when absent/
 * malformed. Accepts { fingerprint } and/or { total, currency } (both strings). Used ONLY for
 * price-drift detection — never trusted as an authoritative price.
 */
export function parseExpectedQuoteInput(raw: unknown): ExpectedQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const hasFp = typeof o.fingerprint === "string" && o.fingerprint.length > 0;
  const hasTotal = typeof o.total === "string" && typeof o.currency === "string";
  if (hasFp && hasTotal) return { fingerprint: o.fingerprint as string, total: o.total as string, currency: o.currency as string };
  if (hasFp) return { fingerprint: o.fingerprint as string };
  if (hasTotal) return { total: o.total as string, currency: o.currency as string };
  return null;
}
