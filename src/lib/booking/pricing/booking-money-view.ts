import { Prisma } from "@prisma/client";
import { resolveBookingMoney, type BookingMoneyInput } from "./resolve-booking-money";

// BOOKING TOTAL PRESENTATION — the ONE shared, PURE presentation view of a booking's money.
//
// The previous gate (Downstream Money Alignment) made every FINANCIAL MUTATION derive from
// resolveBookingMoney() via resolveBookingChargeMoney(). This gate makes the READ / DISPLAY
// side consistent the same way: every booking surface (customer, provider, admin, API) reads
// its money from HERE, so a card, a detail page, and an API DTO can never disagree about what
// a booking's total is, and none of them re-multiplies unit × seats in a component.
//
// It is a THIN, presentation-shaped wrapper over resolveBookingMoney — it adds NO new money
// math (no multiplication, no fallback). It only:
//   • quantizes the resolver's Decimals to the app's canonical 2dp display strings, and
//   • collapses the resolver's INVALID / ABSENT / legacy-without-currency states into a single
//     `available: false` so presentation shows an honest "unavailable", NEVER the unit price
//     dressed up as the total (§20). A legacy booking with a unit amount but no currency is
//     un-presentable for the same reason the charge seam refuses to fund from it.
//
// LEGACY (bookingTotalSnapshot NULL): the effective total IS the historical unit snapshot,
// verbatim — never × seats, no invented billable quantity (§4). `pricingUnit`/`billableQuantity`
// stay null so a component cannot render a multiplication that never happened.
//
// TOTALIZED: carries the authoritative total plus the immutable unit / basis / billableQuantity
// the total was computed from, so a detail page can show the real breakdown (§14).

export type BookingMoneyView =
  | {
      available: true;
      moneyMode: "LEGACY";
      /// The historical booking amount = the unit snapshot. NOT a per-unit price that was
      /// multiplied — legacy bookings have no persisted multiplier, so there is nothing to show
      /// as "unit × quantity".
      total: string;
      unitAmount: string;
      currency: string;
      pricingUnit: null;
      billableQuantity: null;
    }
  | {
      available: true;
      moneyMode: "TOTALIZED";
      /// The authoritative persisted total.
      total: string;
      /// The immutable unit price the total was computed from.
      unitAmount: string;
      currency: string;
      /// Governed pricing-unit CODE (basis) — resolve a label via pricingUnitLabelKey().
      pricingUnit: string;
      /// The multiplier actually applied (1 for FIXED units; the quantity for PER_PERSON).
      billableQuantity: number;
    }
  /// INVALID (corrupt totalized snapshot), ABSENT (no money), or LEGACY without a currency —
  /// presentation shows a safe "unavailable" state and NEVER falls back to the unit price.
  | { available: false };

// 2dp is the app's single canonical money precision (every money column is Decimal(12,2)); this
// matches it exactly via Decimal.toFixed — never Number()/parseFloat, so no precision is lost and
// no new arithmetic is introduced. (The OMR-is-really-3dp concern is real-world debt tracked for a
// future currency-precision gate; this gate deliberately does not change it.)
function toDisplayAmount(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/**
 * Resolve a booking's money into a single presentation view. Pure and deterministic — the same
 * snapshots always render the same way, everywhere.
 */
export function resolveBookingMoneyView(input: BookingMoneyInput): BookingMoneyView {
  const money = resolveBookingMoney(input);
  switch (money.state) {
    case "LEGACY":
      // A legacy booking with no currency is un-presentable (an amount with no unit of account) —
      // treat it as unavailable, exactly as the existing read models already do by requiring both
      // amount AND currency before showing anything.
      if (!money.currency) return { available: false };
      return {
        available: true,
        moneyMode: "LEGACY",
        total: toDisplayAmount(money.effectiveTotal),
        unitAmount: toDisplayAmount(money.unitAmount),
        currency: money.currency,
        pricingUnit: null,
        billableQuantity: null,
      };
    case "TOTALIZED":
      return {
        available: true,
        moneyMode: "TOTALIZED",
        total: toDisplayAmount(money.effectiveTotal),
        unitAmount: toDisplayAmount(money.unitAmount),
        currency: money.currency,
        pricingUnit: money.pricingUnit,
        billableQuantity: money.billableQuantity,
      };
    case "INVALID":
    case "ABSENT":
      return { available: false };
  }
}

// ── Presentation helpers (pure) ─────────────────────────────────────────────────────────────
//
// These centralize "what does a booking's money look like on screen" so compact surfaces (cards,
// lists) and detail surfaces (customer/provider/admin) never disagree or re-derive it.

/**
 * The single compact money fact for a card/list row: the authoritative TOTAL as "<amount> <cur>",
 * or null when the money is unavailable (INVALID/ABSENT/legacy-without-currency) so the caller can
 * render its own honest "unavailable" label. NEVER returns the unit price as the total.
 */
export function formatBookingTotal(view: BookingMoneyView): string | null {
  return view.available ? `${view.total} ${view.currency}` : null;
}

/// One row of a detail-page money breakdown. Kept as data (not JSX) so the shared component AND
/// the admin `dl` render the exact same rows from one decision.
export type BookingMoneyRow =
  /// The per-unit price the total was built from — shown ONLY when a real multiplication happened
  /// (billableQuantity > 1). `pricingUnit` is the basis code for a localized "(per person)" hint.
  | { kind: "unit"; amount: string; currency: string; pricingUnit: string }
  /// The multiplier that was applied — shown ONLY when billableQuantity > 1.
  | { kind: "quantity"; value: number }
  /// The headline figure. `mode` picks the label (LEGACY → "booking amount", TOTALIZED → "total").
  /// `pricingUnit` is non-null ONLY for a FIXED totalized booking (no unit row), so the basis can
  /// still be shown as a hint on the total line; null otherwise.
  | { kind: "total"; amount: string; currency: string; mode: "LEGACY" | "TOTALIZED"; pricingUnit: string | null };

/**
 * Decompose a booking's money into the ordered rows a detail page should show, or null when the
 * money is unavailable. No multiplication is ever fabricated: a legacy booking yields a single
 * amount row; a FIXED totalized booking (quantity 1) yields a single total row (with its basis);
 * only a genuine quantity-based total (quantity > 1) yields the unit × quantity → total breakdown.
 */
export function bookingMoneyRows(view: BookingMoneyView): BookingMoneyRow[] | null {
  if (!view.available) return null;

  if (view.moneyMode === "LEGACY") {
    return [{ kind: "total", amount: view.total, currency: view.currency, mode: "LEGACY", pricingUnit: null }];
  }

  // TOTALIZED. A multiplier actually applied only when billableQuantity > 1 (FIXED units bill 1).
  if (view.billableQuantity > 1) {
    return [
      { kind: "unit", amount: view.unitAmount, currency: view.currency, pricingUnit: view.pricingUnit },
      { kind: "quantity", value: view.billableQuantity },
      { kind: "total", amount: view.total, currency: view.currency, mode: "TOTALIZED", pricingUnit: null },
    ];
  }

  // FIXED (or quantity-1) totalized: unit == total, so show one total row carrying the basis hint.
  return [{ kind: "total", amount: view.total, currency: view.currency, mode: "TOTALIZED", pricingUnit: view.pricingUnit }];
}

// Row shape the booking read models already have in hand — the five money snapshot scalars live
// on every Booking row (a plain `include` returns them). This adapter keeps the ~8 read models
// from each hand-rolling the same cast + field mapping.
export type BookingMoneySnapshotRow = {
  priceSnapshotAmount: unknown;
  priceSnapshotCurrency: string | null;
  pricingUnitSnapshot: string | null;
  billableQuantitySnapshot: number | null;
  bookingTotalSnapshot: unknown;
};

/** Build the shared presentation view from a raw Booking row's money snapshots. */
export function bookingMoneyViewFromRow(row: BookingMoneySnapshotRow): BookingMoneyView {
  return resolveBookingMoneyView({
    priceSnapshotAmount: row.priceSnapshotAmount as Prisma.Decimal | string | number | null,
    priceSnapshotCurrency: row.priceSnapshotCurrency,
    pricingUnitSnapshot: row.pricingUnitSnapshot,
    billableQuantitySnapshot: row.billableQuantitySnapshot,
    bookingTotalSnapshot: row.bookingTotalSnapshot as Prisma.Decimal | string | number | null,
  });
}
