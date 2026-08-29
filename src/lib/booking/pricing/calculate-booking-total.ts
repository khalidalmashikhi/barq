import { Prisma } from "@prisma/client";
import { isValidPricingUnit, type PricingUnit } from "@/lib/pricing-units/registry";
import { classifyBillability } from "@/lib/pricing-units/billability";

// PRICING FOUNDATION — the ONE authoritative, PURE booking-total calculator.
//
// INERT in this gate: no production path calls it yet (createBooking still snapshots the
// unit price only). It exists so the NEXT gate (Booking Total Calculation) has a single,
// tested, deterministic source of truth for every booking total.
//
// MONEY IS DECIMAL, NEVER FLOAT. It uses Prisma.Decimal throughout — never Number(),
// parseFloat(), or `*` on a JS number. For V1 the multiplier is an integer and the unit
// amount is 2dp, so unit × quantity is exactly representable at 2dp; the result is still
// quantized to 2dp under one explicit, documented policy (ROUND_HALF_UP) so the contract
// is stable when later layers (tax/fees) introduce non-exact intermediates.
//
// `subtotal` and `total` are returned separately on purpose: in V1 they are equal, but a
// future tax/discount/fee layer inserts BETWEEN them without changing this contract or any
// caller. Only `total` is authoritative; `subtotal` is pre-adjustment.

const MONEY_DP = 2;
// OMR is a 3-decimal currency in ISO 4217, but every BARQ money column is Decimal(12,2)
// and the whole app prices/stores/deducts at 2dp (Price.amount, priceSnapshotAmount,
// commissionSnapshotAmount, Payment.amount, Wallet). This calculator matches that single
// canonical 2dp convention; it does not invent a new precision. ROUND_HALF_UP is the
// explicit rounding policy (the prior float `toFixed(2)` had no documented, Decimal-safe
// rule — this establishes one without altering any existing stored value).
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

export type BookingTotalError =
  /// pricingUnit is not a governed code (fail-closed; never defaulted).
  | "UNKNOWN_PRICING_UNIT"
  /// PER_DAY / PER_HOUR — needs a billable duration BARQ does not capture yet.
  | "UNSUPPORTED_BILLABLE_DURATION"
  /// bookingQuantity is not a positive integer.
  | "INVALID_QUANTITY"
  /// unitAmount is missing, non-numeric, or negative.
  | "INVALID_UNIT_AMOUNT";

export type BookingTotalInput = {
  unitAmount: Prisma.Decimal | string | number;
  currency: string;
  pricingUnit: string;
  /// The customer's requested quantity (today: Booking.seats). Used as the multiplier ONLY
  /// for QUANTITY_BASED units; FIXED units bill 1 regardless.
  bookingQuantity: number;
};

export type BookingTotal = {
  unitAmount: Prisma.Decimal;
  currency: string;
  pricingUnit: PricingUnit;
  /// The multiplier actually applied: bookingQuantity for QUANTITY_BASED, 1 for FIXED.
  billableQuantity: number;
  /// Pre-adjustment (== total in V1). NOT persisted this gate.
  subtotal: Prisma.Decimal;
  /// The authoritative booking total.
  total: Prisma.Decimal;
};

export type BookingTotalResult = { ok: true; value: BookingTotal } | { ok: false; error: BookingTotalError };

function toDecimalOrNull(value: Prisma.Decimal | string | number): Prisma.Decimal | null {
  try {
    const d = new Prisma.Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Compute the authoritative booking total for a single selected price. Deterministic and
 * side-effect-free. Fails closed on every malformed / unsupported input rather than
 * guessing.
 */
export function calculateBookingTotal(input: BookingTotalInput): BookingTotalResult {
  // 1) Unit amount — must parse to a finite, non-negative Decimal.
  const unitAmount = toDecimalOrNull(input.unitAmount);
  if (unitAmount === null || unitAmount.isNegative()) {
    return { ok: false, error: "INVALID_UNIT_AMOUNT" };
  }

  // 2) Quantity — structural validity only (a positive integer). Service-specific
  //    min/max bounds are NOT this function's concern (createBooking owns them).
  if (!Number.isInteger(input.bookingQuantity) || input.bookingQuantity <= 0) {
    return { ok: false, error: "INVALID_QUANTITY" };
  }

  // 3) Pricing unit — governed + supported.
  if (!isValidPricingUnit(input.pricingUnit)) {
    return { ok: false, error: "UNKNOWN_PRICING_UNIT" };
  }
  const billability = classifyBillability(input.pricingUnit); // non-null (valid unit)
  if (billability === "DURATION_BASED_UNSUPPORTED") {
    return { ok: false, error: "UNSUPPORTED_BILLABLE_DURATION" };
  }

  const billableQuantity = billability === "QUANTITY_BASED" ? input.bookingQuantity : 1;

  // Decimal multiply, then quantize ONCE to the canonical 2dp policy.
  const subtotal = unitAmount.mul(billableQuantity).toDecimalPlaces(MONEY_DP, ROUNDING);
  const total = subtotal; // V1: no tax/fees/discounts — total == subtotal.

  return {
    ok: true,
    value: { unitAmount, currency: input.currency, pricingUnit: input.pricingUnit, billableQuantity, subtotal, total },
  };
}
