import { Prisma } from "@prisma/client";
import { parseOmanDateKey } from "@/lib/date/oman-time";

// Phase 3C Slice C2a — the ISOLATED, pure authoritative calculator for per-vehicle,
// per-Oman-calendar-day pricing. It is DELIBERATELY separate from the legacy
// calculate-booking-total.ts (which never sees PER_VEHICLE_DAY): passenger count is
// NEVER an input and NEVER multiplies the price; a vehicle-day total is simply the sum
// of each selected day's authoritative daily rate.
//
// It performs NO I/O (no Prisma, no external state). The caller resolves each day's
// authoritative rate (override ?? base) and passes a normalized per-date list. Currency
// lives PER DATE so a mixed-currency set is detectable (a single top-level currency
// could not express a mismatch); all rates in one call must share one non-empty currency.
//
// Money contract (matches the project): Prisma.Decimal only (never JS float), 2 decimal
// places, ROUND_HALF_UP; amounts are returned as stable 2dp strings.
//
// TWO SEPARATE MEANINGS for the SAME calculator (distinct calls, distinct semantics):
//   • called with ALL AVAILABLE days in a calendar window → `lowestDailyRate` is the
//     calendar's "from" headline price (the fare-calendar lowest available rate);
//   • called with ONLY the customer-SELECTED dates → `total` is the booking total
//     (used by a future C3 booking calculation). Never conflate the two.

const MONEY_DP = 2;
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

export type VehicleDailyRateInput = {
  /** Oman calendar day "YYYY-MM-DD". */
  dateKey: string;
  money: {
    /** Authoritative daily rate (override ?? base), already resolved by the caller. */
    amount: Prisma.Decimal | string;
    currency: string;
  };
};

export type VehicleDailyCalculationFailure =
  | "EMPTY"
  | "DUPLICATE_DATE"
  | "MIXED_CURRENCY"
  | "INVALID_RATE"
  | "INVALID_DATE_KEY";

export type VehicleDailyCalculation =
  | {
      ok: true;
      value: {
        /** Successful dates, sorted chronologically, unique. */
        dateKeys: string[];
        /** Per-date resolved rate, sorted chronologically; amounts are 2dp strings. */
        perDate: { dateKey: string; amount: string; currency: string }[];
        /** Number of supplied valid dates ( = number of chargeable days). */
        chargeableDays: number;
        currency: string;
        /** Exact Decimal sum of the daily rates, as a 2dp string. */
        total: string;
        /** Minimum of the supplied daily rates, as a 2dp string. */
        lowestDailyRate: string;
      };
    }
  | { ok: false; reason: VehicleDailyCalculationFailure };

// A valid daily rate is a finite Decimal, strictly positive, with at most 2 decimal
// places (over-precision is rejected, not silently rounded, per the money contract).
function toValidRateDecimal(amount: Prisma.Decimal | string): Prisma.Decimal | null {
  let d: Prisma.Decimal;
  try {
    d = amount instanceof Prisma.Decimal ? amount : new Prisma.Decimal(amount);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lte(0)) return null;
  if (d.decimalPlaces() > MONEY_DP) return null;
  return d;
}

export function calculateVehicleDailyTotal(days: VehicleDailyRateInput[]): VehicleDailyCalculation {
  if (!Array.isArray(days) || days.length === 0) return { ok: false, reason: "EMPTY" };

  // Validate every date key (never silently omit an invalid day) + detect duplicates.
  const seen = new Set<string>();
  const normalized: { dateKey: string; amount: Prisma.Decimal; currency: string }[] = [];
  const currencies = new Set<string>();

  for (const day of days) {
    const key = parseOmanDateKey(day?.dateKey);
    if (key === null) return { ok: false, reason: "INVALID_DATE_KEY" };
    if (seen.has(key)) return { ok: false, reason: "DUPLICATE_DATE" };
    seen.add(key);

    const currency = typeof day?.money?.currency === "string" ? day.money.currency.trim() : "";
    currencies.add(currency);

    const rate = toValidRateDecimal(day?.money?.amount);
    if (rate === null) return { ok: false, reason: "INVALID_RATE" };

    normalized.push({ dateKey: key, amount: rate, currency });
  }

  // Exactly one non-empty common currency.
  if (currencies.size !== 1 || currencies.has("")) return { ok: false, reason: "MIXED_CURRENCY" };
  const currency = [...currencies][0]!;

  normalized.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  let total = new Prisma.Decimal(0);
  let lowest = normalized[0]!.amount;
  for (const row of normalized) {
    total = total.plus(row.amount);
    if (row.amount.lt(lowest)) lowest = row.amount;
  }

  return {
    ok: true,
    value: {
      dateKeys: normalized.map((r) => r.dateKey),
      perDate: normalized.map((r) => ({ dateKey: r.dateKey, amount: r.amount.toFixed(MONEY_DP), currency })),
      chargeableDays: normalized.length,
      currency,
      total: total.toDecimalPlaces(MONEY_DP, ROUNDING).toFixed(MONEY_DP),
      lowestDailyRate: lowest.toFixed(MONEY_DP),
    },
  };
}
