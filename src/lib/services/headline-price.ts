import type { Prisma } from "@prisma/client";

// DISCOVERY & DETAIL TRUTHFULNESS — the ONE deterministic rule for the single
// "headline" price shown on a card or a detail summary. PURE and framework-free
// (no server-only), so it is the single source of truth wherever a headline price
// is derived (listing, detail summary, preview, related, home discovery).
//
// The bug it replaces: every caller used `prices[0]` off an UNORDERED `take: 1`
// include, so a service with several ACTIVE prices showed an arbitrary one — and
// Home even labelled it "From {price}" while showing a non-minimum. This helper
// makes the headline the genuine MINIMUM within a single currency and only claims
// "from" when there is really more than one price to be the minimum OF.
//
// MULTI-CURRENCY SAFETY (§8): the Price schema does not constrain one currency per
// service, but amounts in different currencies are NOT comparable. So this NEVER
// computes a cross-currency minimum. It scopes to a single deterministic "primary"
// currency (the service's earliest ACTIVE price's currency) and reports the minimum
// within it, flagging `multiCurrency` for callers/telemetry. In this OMR marketplace
// a service is single-currency in practice; the flag exists to surface the schema
// integrity gap, not to paper a fake global minimum over it.

export type HeadlinePriceInput = {
  amount: Prisma.Decimal | number | string;
  currency: string;
  pricingUnit?: string | null;
  /// Optional determinism keys — when present, the primary currency is the earliest
  /// (createdAt, id) ACTIVE price's currency. Absent → the caller's own query order.
  createdAt?: Date;
  id?: string;
};

export type HeadlinePrice = {
  /// The minimum amount within the primary currency, as a plain string.
  amount: string;
  currency: string;
  pricingUnit: string | null;
  /// True when there is more than one ACTIVE price in the primary currency, i.e. the
  /// amount shown is a floor ("From X"), not the only price.
  isFrom: boolean;
  /// True when the service has ACTIVE prices in more than one currency — an integrity
  /// signal for reporting; the display still shows a single real, primary-currency price.
  multiCurrency: boolean;
};

function toNumber(amount: Prisma.Decimal | number | string): number {
  return typeof amount === "number" ? amount : Number(amount.toString());
}

// Deterministic order for "earliest": createdAt asc, then id asc. Rows missing these
// keys keep their incoming relative order (a stable sort), so a caller that already
// ordered its query stays deterministic.
function earliestFirst(a: HeadlinePriceInput, b: HeadlinePriceInput): number {
  if (a.createdAt && b.createdAt && a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }
  if (a.id && b.id && a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Resolve the headline price from a service's ACTIVE prices. Returns null when there
 * are none (the service is not bookable on price grounds). Callers pass ONLY ACTIVE
 * prices; this does not re-filter status.
 */
export function resolveHeadlinePrice(activePrices: HeadlinePriceInput[]): HeadlinePrice | null {
  if (activePrices.length === 0) return null;

  const ordered = [...activePrices].sort(earliestFirst);
  const primaryCurrency = ordered[0]!.currency;
  const sameCurrency = ordered.filter((p) => p.currency === primaryCurrency);
  const multiCurrency = ordered.some((p) => p.currency !== primaryCurrency);

  // Minimum amount within the primary currency; ties resolved by the already-applied
  // earliest-first order (sameCurrency preserves it), so the pick is deterministic.
  let min = sameCurrency[0]!;
  for (const price of sameCurrency) {
    if (toNumber(price.amount) < toNumber(min.amount)) min = price;
  }

  return {
    amount: min.amount.toString(),
    currency: min.currency,
    pricingUnit: min.pricingUnit ?? null,
    isFrom: sameCurrency.length > 1,
    multiCurrency,
  };
}
