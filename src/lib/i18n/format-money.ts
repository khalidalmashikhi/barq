import { formatCurrency } from "./format-number";

// Phase 3C — Slice A. Locale-aware MONEY DISPLAY helper — the single place customer-facing surfaces
// turn an amount + ISO currency code into human text, replacing the raw `${amount} ${currency}`
// concatenation that rendered "40.00 OMR" literally on Arabic screens.
//
// Uses the established Intl-based formatCurrency so the currency presentation localizes: English ->
// "OMR 40.00", Arabic -> "40.00 ر.ع." with the Arabic rial symbol. Digits are pinned to Latin
// (numberingSystem: "latn") so amounts read consistently in both locales, matching the product
// examples ("OMR 75" / "75 ر.ع."); only the currency symbol changes.
//
// DISPLAY ONLY: it never touches stored amounts, booking snapshots, or the authoritative money
// representation — callers pass a value already computed elsewhere. Fail-safe: a non-finite input
// falls back to a plain "amount currency" string rather than throwing.
export function formatMoney(amount: number | string, currency: string, locale: string): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  // Pin to 2 fraction digits to match BARQ's stored money precision (Decimal(12,2)) and the existing
  // display — NOT the ISO default, which for OMR is 3 places (would render a spurious "25.000").
  const formatted = formatCurrency(value, currency, locale, {
    numberingSystem: "latn",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Normalize the (narrow) no-break spaces Intl inserts around the currency symbol (U+00A0 / U+202F)
  // to a regular space so the output is predictable and clean; RTL directional marks are left intact.
  return formatted.replace(/[\u00A0\u202F]/g, " ");
}
