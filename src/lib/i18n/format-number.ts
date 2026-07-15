// Locale-aware number/currency/percent formatting utilities — BARQ
// Internationalization, Phase 0.
//
// FRAMEWORK-INDEPENDENT, same reasoning as format-date.ts — plain
// `Intl.NumberFormat` wrappers, no React/Next.js dependency.
//
// A REAL, PRE-EXISTING GAP THIS PREPARES TO FIX, NOT YET FIXES: the
// architecture analysis found every current price display built via
// raw string concatenation (`${amount} ${currency}`) inside query
// modules under src/lib/ — a business-logic layer baking in a
// presentation decision before the viewer's locale is even known.
// These functions are the replacement primitive; the 6+ existing call
// sites that concatenate price strings are NOT migrated in this
// phase — that migration is later-phase work (Phases C/D), done
// carefully since those query modules are shared across Customer and
// Provider surfaces.
//
// `amount` is typed as `number` — Prisma `Decimal` fields (as used for
// Price.amount) serialize as strings in places; converting a Decimal
// to a plain number is the caller's responsibility at the call site
// that eventually adopts this function, not something silently
// coerced here.

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...options,
  }).format(amount);
}

export function formatPercent(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    ...options,
  }).format(value);
}
