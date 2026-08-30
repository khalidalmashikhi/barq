import type { Billability } from "@/lib/pricing-units/billability";

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — a PURE, isomorphic (client-safe) preview of the expected
// booking total. It is DISPLAY-ONLY and is NEVER trusted on submit: createBooking() re-reads the
// ACTIVE Price server-side and computes the authoritative total via calculateBookingTotal(). This
// is not a second pricing AUTHORITY — the ONE shared rule for which units multiply is
// classifyBillability(), applied on the SERVER (so the raw pricing-unit CODE never crosses to the
// client — only its safe Billability classification does), and this preview is proven, by a
// cross-check test, to agree with the authoritative calculator for every supported case.
//
// WHY INTEGER MINOR UNITS instead of importing the authoritative calculateBookingTotal: that
// calculator uses Prisma.Decimal (`import { Prisma } from "@prisma/client"`), which is a server
// data-access dependency that should not be shipped into a client bundle. Every BARQ money value
// is Decimal(12,2), so a unit amount has at most two fractional digits and the quantity is a
// positive integer — meaning unit × quantity is EXACTLY representable in integer hundredths with
// no floating-point rounding. This computes in that integer minor-unit space and formats back to a
// 2dp string, giving results identical to the Decimal calculator for the supported units.

export type PreviewBookingTotalInput = {
  /// The selected Price's unit amount as a Decimal(12,2) string (e.g. "10", "10.5", "10.25").
  unitAmount: string;
  /// The selected Price's SERVER-classified billability (via classifyBillability) — never the raw
  /// pricing-unit code. null for a legacy/ungoverned unit (not previewable).
  billability: Billability | null;
  /// The current requested quantity (the seats input value, already parsed to a positive integer).
  quantity: number;
};

export type PreviewBookingTotal =
  | { ok: true; billableQuantity: number; total: string }
  /// The unit cannot be previewed: unknown/legacy/duration-based (PER_DAY/PER_HOUR), a malformed
  /// unit amount, or a non-positive-integer quantity. Presentation shows a neutral "unavailable".
  | { ok: false; reason: "UNSUPPORTED_UNIT" | "INVALID_UNIT_AMOUNT" | "INVALID_QUANTITY" };

/** Parse a Decimal(12,2)-shaped amount string to integer minor units (hundredths). No float. */
export function amountToMinorUnits(amount: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  const fractional = (m[2] ?? "").padEnd(2, "0");
  const minor = Number(m[1]) * 100 + Number(fractional);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Format integer minor units back to a 2dp decimal string (e.g. 5125 → "51.25"). */
export function formatMinorUnits(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fractional = String(minor % 100).padStart(2, "0");
  return `${whole}.${fractional}`;
}

/** Normalize a Decimal(12,2)-shaped amount to a stable 2dp display string, or null if malformed. */
export function normalizeDisplayAmount(amount: string): string | null {
  const minor = amountToMinorUnits(amount);
  return minor === null ? null : formatMinorUnits(minor);
}

/**
 * Compute the EXPECTED booking total for a preview. Mirrors the authoritative calculator's
 * per-unit semantics via the shared classifyBillability: QUANTITY_BASED (PER_PERSON) multiplies by
 * quantity; FIXED (PER_BOOKING/PER_TRIP/PER_VEHICLE) bills 1; DURATION_BASED (PER_DAY/PER_HOUR) and
 * unknown/legacy units are not previewable (fail closed — never a guessed total).
 */
export function previewBookingTotal(input: PreviewBookingTotalInput): PreviewBookingTotal {
  if (input.billability === null || input.billability === "DURATION_BASED_UNSUPPORTED") {
    return { ok: false, reason: "UNSUPPORTED_UNIT" };
  }
  const unitMinor = amountToMinorUnits(input.unitAmount);
  if (unitMinor === null) return { ok: false, reason: "INVALID_UNIT_AMOUNT" };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, reason: "INVALID_QUANTITY" };
  }

  const billableQuantity = input.billability === "QUANTITY_BASED" ? input.quantity : 1;
  const totalMinor = unitMinor * billableQuantity;
  // Guard against an implausibly large quantity overflowing exact integer arithmetic.
  if (!Number.isSafeInteger(totalMinor)) return { ok: false, reason: "INVALID_QUANTITY" };

  return { ok: true, billableQuantity, total: formatMinorUnits(totalMinor) };
}
