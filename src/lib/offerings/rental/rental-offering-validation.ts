import { Prisma } from "@prisma/client";

// Phase 3C Slice C2b-R — pure input validation for rental-offering money, currency, and capacity.
// No I/O. Money uses Prisma.Decimal / 2dp (matching the project contract) and never JS float; the
// C1 DB CHECK constraints (baseDailyAmount > 0, override > 0, override capacity > 0) are the second
// line of defence behind these.

// A positive decimal string with at most 2 fractional digits (same shape as admin createPrice).
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Validate + normalize a money amount (base daily rate or a day override). Returns the canonical
 * 2dp Prisma.Decimal or null when malformed / zero / negative / over-precision / non-finite. Never
 * uses JS float arithmetic (validation is string + Decimal).
 */
export function parseOfferingAmount(raw: unknown): Prisma.Decimal | null {
  if (typeof raw !== "string" && typeof raw !== "number") {
    if (raw instanceof Prisma.Decimal) {
      return raw.isFinite() && raw.gt(0) && raw.decimalPlaces() <= 2 ? raw : null;
    }
    return null;
  }
  const s = String(raw).trim();
  if (!AMOUNT_PATTERN.test(s)) return null;
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(s);
  } catch {
    return null;
  }
  return d.isFinite() && d.gt(0) ? d : null;
}

/**
 * Normalize + validate an offering currency. The project has NO stricter currency contract
 * (Price.currency is a free String, OMR in practice, no DB CHECK), so we only require a non-empty
 * trimmed token and normalize to upper-case — deliberately NOT imposing an ISO-4217 format so
 * non-ISO values the project may support are preserved. Returns the normalized code or null.
 */
export function normalizeOfferingCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  if (c.length < 1 || c.length > 10) return null;
  return c;
}

export type CapacityOverrideCheck =
  | { ok: true; effectiveCapacity: number | null }
  | { ok: false; error: "INVALID_CAPACITY_OVERRIDE" | "VERIFIED_CAPACITY_MISSING" };

/**
 * Validate an optional stricter capacity override against the vehicle's provider-entered bookable
 * capacity, and resolve the effective capacity (override ?? verified). The override is a customer
 * party-size CEILING only — never inventory, never a price factor.
 *   • override null            → effective = verified capacity (may be null at draft time).
 *   • override provided        → must be a positive integer AND ≤ the verified capacity, which must
 *                                itself exist (else VERIFIED_CAPACITY_MISSING) — you can never cap
 *                                above a capacity the platform has not established.
 */
export function checkCapacityOverride(
  bookablePassengerCapacity: number | null,
  override: number | null,
): CapacityOverrideCheck {
  if (override === null) return { ok: true, effectiveCapacity: bookablePassengerCapacity };
  if (!Number.isInteger(override) || override <= 0) return { ok: false, error: "INVALID_CAPACITY_OVERRIDE" };
  if (bookablePassengerCapacity === null || bookablePassengerCapacity <= 0) {
    return { ok: false, error: "VERIFIED_CAPACITY_MISSING" };
  }
  if (override > bookablePassengerCapacity) return { ok: false, error: "INVALID_CAPACITY_OVERRIDE" };
  return { ok: true, effectiveCapacity: override };
}
