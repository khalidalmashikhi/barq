import { Prisma } from "@prisma/client";
import { isValidPricingUnit } from "@/lib/pricing-units/registry";

// PRICING FOUNDATION — the ONE compatibility seam between LEGACY bookings (a single unit
// price snapshot, no total) and TOTALIZED bookings (an authoritative bookingTotalSnapshot).
// PURE and isomorphic. It exists so future consumers read a booking's effective money from
// one place instead of scattering `bookingTotalSnapshot ?? priceSnapshotAmount` — but it is
// INERT this gate (no consumer is migrated to it yet; only its own tests exercise it).
//
// It NEVER infers "totalized" from seats or any heuristic. The single discriminator is:
//   bookingTotalSnapshot IS NULL  → LEGACY   (effective total = the historical unit snapshot)
//   bookingTotalSnapshot NOT NULL → TOTALIZED (effective total = the total snapshot)
//
// A TOTALIZED booking must carry a COHERENT snapshot set. If a total is present but its
// companion fields are missing/corrupt, this returns INVALID — it does NOT silently fall
// back to the unit price (that would mask a real data-integrity fault and could under- or
// mis-charge).

export type BookingMoneyInput = {
  /// UNIT price at booking time — meaning UNCHANGED by the pricing foundation.
  priceSnapshotAmount: Prisma.Decimal | string | number | null;
  priceSnapshotCurrency: string | null;
  pricingUnitSnapshot: string | null;
  billableQuantitySnapshot: number | null;
  bookingTotalSnapshot: Prisma.Decimal | string | number | null;
};

export type BookingMoney =
  | {
      state: "LEGACY";
      /// The historical effective total = the unit snapshot (NEVER multiplied by seats).
      effectiveTotal: Prisma.Decimal;
      unitAmount: Prisma.Decimal;
      currency: string | null;
    }
  | {
      state: "TOTALIZED";
      effectiveTotal: Prisma.Decimal;
      unitAmount: Prisma.Decimal;
      currency: string;
      pricingUnit: string;
      billableQuantity: number;
    }
  /// A total exists but its companion snapshot is incoherent — fail closed.
  | { state: "INVALID"; reason: string }
  /// No money data at all (a legacy booking whose unit snapshot is also null).
  | { state: "ABSENT" };

function toDecimalOrNull(value: Prisma.Decimal | string | number | null): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    // Accept a real Prisma.Decimal directly; otherwise construct from a number, or from the
    // string form of anything else (a Decimal-like, a plain string) — decimal.js only accepts
    // number/string/Decimal, so a Decimal instance from another realm goes through its toString.
    const d =
      value instanceof Prisma.Decimal
        ? value
        : new Prisma.Decimal(typeof value === "number" ? value : String(value));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a booking's effective money from its snapshots. Pure and deterministic.
 */
export function resolveBookingMoney(input: BookingMoneyInput): BookingMoney {
  const totalSnapshot = toDecimalOrNull(input.bookingTotalSnapshot);
  const unitSnapshot = toDecimalOrNull(input.priceSnapshotAmount);

  // LEGACY — no total snapshot. Effective total is the historical unit price, verbatim.
  if (totalSnapshot === null) {
    if (unitSnapshot === null) return { state: "ABSENT" };
    return { state: "LEGACY", effectiveTotal: unitSnapshot, unitAmount: unitSnapshot, currency: input.priceSnapshotCurrency };
  }

  // TOTALIZED — a total exists, so the companion snapshot MUST be coherent.
  if (totalSnapshot.isNegative()) return { state: "INVALID", reason: "bookingTotalSnapshot is negative" };
  if (unitSnapshot === null) return { state: "INVALID", reason: "totalized booking is missing its unit price snapshot" };
  if (!input.pricingUnitSnapshot || !isValidPricingUnit(input.pricingUnitSnapshot)) {
    return { state: "INVALID", reason: "totalized booking is missing/invalid pricingUnitSnapshot" };
  }
  if (input.billableQuantitySnapshot === null || !Number.isInteger(input.billableQuantitySnapshot) || input.billableQuantitySnapshot <= 0) {
    return { state: "INVALID", reason: "totalized booking has a missing/invalid billableQuantitySnapshot" };
  }
  if (!input.priceSnapshotCurrency) {
    return { state: "INVALID", reason: "totalized booking is missing its currency" };
  }

  return {
    state: "TOTALIZED",
    effectiveTotal: totalSnapshot,
    unitAmount: unitSnapshot,
    currency: input.priceSnapshotCurrency,
    pricingUnit: input.pricingUnitSnapshot,
    billableQuantity: input.billableQuantitySnapshot,
  };
}

// ── Financial seam ────────────────────────────────────────────────────────────────────
//
// The SINGLE gate every financial MUTATION (commission, Payment.amount, gateway initiation,
// Invoice, refund basis) and revenue path passes through to obtain the one authoritative
// amount to charge/record. It fails closed rather than ever charging from a corrupt/absent
// snapshot — an INVALID totalized booking is NEVER silently downgraded to its unit price, and
// a booking with no money (or a legacy row with no currency) cannot fund a financial artifact.

export type BookingChargeMoney = { total: Prisma.Decimal; currency: string };
export type BookingChargeResult = { ok: true; money: BookingChargeMoney } | { ok: false; reason: string };

/**
 * Resolve the authoritative amount to charge/record for a booking. LEGACY (with a currency)
 * and TOTALIZED are chargeable at their effective total; INVALID, ABSENT, and a LEGACY row
 * missing its currency FAIL CLOSED.
 */
export function resolveBookingChargeMoney(input: BookingMoneyInput): BookingChargeResult {
  const money = resolveBookingMoney(input);
  switch (money.state) {
    case "TOTALIZED":
      return { ok: true, money: { total: money.effectiveTotal, currency: money.currency } };
    case "LEGACY":
      if (!money.currency) return { ok: false, reason: "legacy booking has no currency" };
      return { ok: true, money: { total: money.effectiveTotal, currency: money.currency } };
    case "INVALID":
      return { ok: false, reason: money.reason };
    case "ABSENT":
      return { ok: false, reason: "no booking money" };
  }
}
