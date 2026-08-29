import "server-only";
import { Prisma, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { EFFECTIVE_BOOKING_TOTAL } from "@/lib/booking/pricing/effective-total-aggregate";
import { getOmanTodayRangeUtc } from "./get-provider-overview";

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;
const money = (d: Prisma.Decimal | null | undefined) =>
  (d ? new Prisma.Decimal(d) : new Prisma.Decimal(0)).toDecimalPlaces(2, ROUNDING).toFixed(2);

// Provider Billing & Earnings Foundation.
//
// OPERATIONAL FINANCIAL SUMMARY, NOT ACCOUNTING — READ THIS BEFORE
// EXTENDING THIS FILE. Every figure below is derived directly from
// Booking.priceSnapshotAmount / Booking.commissionSnapshotAmount — the
// same two fields get-provider-metrics.ts already uses for its
// "Revenue (Completed)" KPI. This module is NOT an accounting ledger,
// a payout/settlement system, an invoice-reconciliation tool, or a
// tax-reporting source. It never reads Payment, Invoice, Wallet, or
// WalletTransaction — all confirmed schema-only or admin-only,
// unrelated to provider-facing revenue (see this phase's own
// inspection report). Do not wire a real payout/settlement/ledger
// feature into this module later — build that against its own real
// data source, and only fold in a re-derivation here once the two are
// proven equivalent.
//
// REVENUE-RECOGNITION RULE FOR THIS PHASE: confirmedAt, never
// createdAt, and there is no completedAt field to mix in. Every
// Booking that ever reaches COMPLETED has already passed through
// CONFIRMED (see lifecycle/transitions.ts: COMPLETED is only reachable
// via CONFIRMED -> IN_PROGRESS -> COMPLETED), so confirmedAt is always
// a real, non-null timestamp for any booking counted as revenue here.
// createdAt marks when the customer's request was submitted, before
// price was even locked in, and is deliberately never used for period
// bucketing.
//
// MULTI-CURRENCY, NEVER MERGED: every monetary figure below is an
// array grouped by currency (CurrencyAmount[]), mirroring
// get-provider-metrics.ts's own totalRevenueByCurrency shape exactly.
// Real production data is single-currency (OMR) today (confirmed via
// prisma/seed.ts inspection), but this module never assumes that — no
// cross-currency sum, no cross-currency average, no conversion is ever
// performed anywhere in this file.
//
// ESTIMATED, NOT GUARANTEED: commissionSnapshotAmount is null for any
// booking whose provider had no ACTIVE Commission row at the moment it
// was confirmed (accept-booking.ts logs this, never blocks, never
// backfills). SQL SUM() already skips NULLs, so a booking with a null
// commission snapshot contributes its full gross price to "Estimated
// Net Earnings" with zero commission subtracted — an honest
// consequence of the underlying data, not a bug, and exactly why this
// figure is labeled "Estimated," never "Net Earnings" or "Payout."

export type CurrencyAmount = { amount: string; currency: string };

export type ProviderServiceRevenueItem = {
  serviceId: string;
  serviceName: string;
  completedBookingsCount: number;
  totalRevenue: string;
  averageBookingValue: string;
};

/// One group per currency actually present in the provider's completed
/// bookings — services within a group are ranked against each other
/// only (never across currencies). Ordering within `services`: highest
/// totalRevenue first; ties broken by more completedBookingsCount;
/// remaining ties broken alphabetically by serviceName — the exact
/// rule specified for this phase, never left as raw groupBy order.
export type ProviderServiceRevenueGroup = {
  currency: string;
  services: ProviderServiceRevenueItem[];
};

export type ProviderEarningsSummary = {
  grossRevenueByCurrency: CurrencyAmount[];
  estimatedNetEarningsByCurrency: CurrencyAmount[];
  cancelledLostRevenueByCurrency: CurrencyAmount[];
  pendingRevenueByCurrency: CurrencyAmount[];
  averageBookingValueByCurrency: CurrencyAmount[];
  grossRevenueTodayByCurrency: CurrencyAmount[];
  grossRevenueThisMonthByCurrency: CurrencyAmount[];
  revenueByService: ProviderServiceRevenueGroup[];
};

type RevenueBucket = "completed" | "cancelledOrRejected" | "pending";

/// Cancelled/Lost Revenue combines CANCELLED and REJECTED — both
/// represent business that will never be collected. Pending Revenue
/// uses the exact same "still active" status set get-provider-
/// overview.ts's own activeBookingsCount already uses, for consistency
/// with how "active" is defined elsewhere on this dashboard.
const STATUS_TO_BUCKET: Partial<Record<BookingStatus, RevenueBucket>> = {
  COMPLETED: "completed",
  CANCELLED: "cancelledOrRejected",
  REJECTED: "cancelledOrRejected",
  PENDING_PROVIDER: "pending",
  CONFIRMED: "pending",
  IN_PROGRESS: "pending",
};

const BUCKETED_STATUSES = Object.keys(STATUS_TO_BUCKET) as BookingStatus[];

function getOmanMonthStartUtc(now: Date): Date {
  // Same fixed +4h technique as getOmanTodayRangeUtc (see that
  // function's own comment) — safe specifically because Asia/Muscat
  // observes no DST; would NOT generalize to a DST-observing timezone.
  const OMAN_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;
  const omanShifted = new Date(now.getTime() + OMAN_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(omanShifted.getUTCFullYear(), omanShifted.getUTCMonth(), 1, 0, 0, 0, 0) - OMAN_UTC_OFFSET_MS
  );
}

// DOWNSTREAM MONEY ALIGNMENT — all monetary accumulation is Prisma.Decimal, never JS number
// (the prior version summed via Number()/+= and toFixed). Gross is the EFFECTIVE booking total.
type BucketTotals = { sumPrice: Prisma.Decimal; sumCommission: Prisma.Decimal; count: number; avgPrice: Prisma.Decimal };

function emptyBucketTotals(): BucketTotals {
  return { sumPrice: new Prisma.Decimal(0), sumCommission: new Prisma.Decimal(0), count: 0, avgPrice: new Prisma.Decimal(0) };
}

function toSortedCurrencyAmounts(entries: Array<[string, Prisma.Decimal]>): CurrencyAmount[] {
  return entries
    .map(([currency, amount]) => ({ amount: money(amount), currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function getProviderEarnings(): Promise<ProviderEarningsSummary> {
  const { provider } = await requireProvider();
  const providerId = provider.id;
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";

  const now = new Date();
  const { start: todayStart, end: todayEnd } = getOmanTodayRangeUtc(now);
  const monthStart = getOmanMonthStartUtc(now);

  // Sums use the EFFECTIVE booking total (COALESCE(bookingTotalSnapshot, priceSnapshotAmount))
  // via raw SQL — Prisma's groupBy _sum cannot express the COALESCE. Commission (already a
  // snapshot) is summed alongside for "Estimated Net". One grouped query per shape; SUM/AVG
  // ignore NULLs. `status = 'COMPLETED'` is a literal; the bucket list is parameterized.
  type StatusRow = { status: BookingStatus; currency: string | null; sumtotal: Prisma.Decimal | null; sumcommission: Prisma.Decimal | null; avgtotal: Prisma.Decimal | null; count: bigint };
  type CurrencySumRow = { currency: string | null; sumtotal: Prisma.Decimal | null };
  type ServiceRow = { serviceId: string; currency: string | null; sumtotal: Prisma.Decimal | null; avgtotal: Prisma.Decimal | null; count: bigint };

  const [statusCurrencyRows, todayRows, monthRows, serviceRows] = await Promise.all([
    prisma.$queryRaw<StatusRow[]>(Prisma.sql`
      SELECT status, "priceSnapshotCurrency" AS currency,
             SUM(${EFFECTIVE_BOOKING_TOTAL}) AS sumtotal,
             SUM("commissionSnapshotAmount") AS sumcommission,
             AVG(${EFFECTIVE_BOOKING_TOTAL}) AS avgtotal,
             COUNT(*) AS count
      FROM "bookings"
      WHERE "providerId" = ${providerId}::uuid AND status::text IN (${Prisma.join(BUCKETED_STATUSES)})
      GROUP BY status, "priceSnapshotCurrency"
    `),
    prisma.$queryRaw<CurrencySumRow[]>(Prisma.sql`
      SELECT "priceSnapshotCurrency" AS currency, SUM(${EFFECTIVE_BOOKING_TOTAL}) AS sumtotal
      FROM "bookings"
      WHERE "providerId" = ${providerId}::uuid AND status = 'COMPLETED'
        AND "confirmedAt" >= ${todayStart} AND "confirmedAt" < ${todayEnd}
      GROUP BY "priceSnapshotCurrency"
    `),
    prisma.$queryRaw<CurrencySumRow[]>(Prisma.sql`
      SELECT "priceSnapshotCurrency" AS currency, SUM(${EFFECTIVE_BOOKING_TOTAL}) AS sumtotal
      FROM "bookings"
      WHERE "providerId" = ${providerId}::uuid AND status = 'COMPLETED' AND "confirmedAt" >= ${monthStart}
      GROUP BY "priceSnapshotCurrency"
    `),
    prisma.$queryRaw<ServiceRow[]>(Prisma.sql`
      SELECT "serviceId", "priceSnapshotCurrency" AS currency,
             SUM(${EFFECTIVE_BOOKING_TOTAL}) AS sumtotal,
             AVG(${EFFECTIVE_BOOKING_TOTAL}) AS avgtotal,
             COUNT(*) AS count
      FROM "bookings"
      WHERE "providerId" = ${providerId}::uuid AND status = 'COMPLETED'
      GROUP BY "serviceId", "priceSnapshotCurrency"
    `),
  ]);

  const buckets: Record<RevenueBucket, Map<string, BucketTotals>> = {
    completed: new Map(),
    cancelledOrRejected: new Map(),
    pending: new Map(),
  };

  for (const row of statusCurrencyRows) {
    const currency = row.currency;
    const bucketName = STATUS_TO_BUCKET[row.status];
    if (!currency || !bucketName) continue;

    const totals = buckets[bucketName].get(currency) ?? emptyBucketTotals();
    totals.sumPrice = totals.sumPrice.plus(row.sumtotal ?? 0);
    totals.sumCommission = totals.sumCommission.plus(row.sumcommission ?? 0);
    totals.count += Number(row.count);
    // Only meaningful for the "completed" bucket (a single status); never read for the
    // multi-status buckets. Postgres already averaged the effective total for this group.
    if (row.avgtotal !== null) {
      totals.avgPrice = new Prisma.Decimal(row.avgtotal);
    }
    buckets[bucketName].set(currency, totals);
  }

  const grossRevenueByCurrency = toSortedCurrencyAmounts(
    Array.from(buckets.completed.entries()).map(([currency, t]) => [currency, t.sumPrice])
  );
  const estimatedNetEarningsByCurrency = toSortedCurrencyAmounts(
    Array.from(buckets.completed.entries()).map(([currency, t]) => [currency, t.sumPrice.minus(t.sumCommission)])
  );
  const cancelledLostRevenueByCurrency = toSortedCurrencyAmounts(
    Array.from(buckets.cancelledOrRejected.entries()).map(([currency, t]) => [currency, t.sumPrice])
  );
  const pendingRevenueByCurrency = toSortedCurrencyAmounts(
    Array.from(buckets.pending.entries()).map(([currency, t]) => [currency, t.sumPrice])
  );
  const averageBookingValueByCurrency = toSortedCurrencyAmounts(
    Array.from(buckets.completed.entries()).map(([currency, t]) => [currency, t.avgPrice])
  );

  const grossRevenueTodayByCurrency: CurrencyAmount[] = todayRows
    .filter((row) => row.currency && row.sumtotal !== null)
    .map((row) => ({ amount: money(row.sumtotal), currency: row.currency as string }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const grossRevenueThisMonthByCurrency: CurrencyAmount[] = monthRows
    .filter((row) => row.currency && row.sumtotal !== null)
    .map((row) => ({ amount: money(row.sumtotal), currency: row.currency as string }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const serviceIds = Array.from(new Set(serviceRows.map((row) => row.serviceId)));
  const services = serviceIds.length > 0
    ? await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
    : [];
  const serviceNameById = new Map(services.map((s) => [s.id, extractLocalizedText(s.name, locale) || fallbackServiceName]));

  const revenueByServiceMap = new Map<string, ProviderServiceRevenueItem[]>();
  for (const row of serviceRows) {
    const currency = row.currency;
    if (!currency || row.sumtotal === null) continue;

    const item: ProviderServiceRevenueItem = {
      serviceId: row.serviceId,
      serviceName: serviceNameById.get(row.serviceId) ?? fallbackServiceName,
      completedBookingsCount: Number(row.count),
      totalRevenue: money(row.sumtotal),
      averageBookingValue: money(row.avgtotal),
    };
    const list = revenueByServiceMap.get(currency) ?? [];
    list.push(item);
    revenueByServiceMap.set(currency, list);
  }

  const revenueByService: ProviderServiceRevenueGroup[] = Array.from(revenueByServiceMap.entries())
    .map(([currency, items]) => ({
      currency,
      // Ordering rule for this phase: revenue desc -> completed count
      // desc -> serviceName alphabetical. Documented, never left as
      // whatever order groupBy happened to return.
      services: items.sort((a, b) => {
        const revenueDiff = Number(b.totalRevenue) - Number(a.totalRevenue);
        if (revenueDiff !== 0) return revenueDiff;
        const countDiff = b.completedBookingsCount - a.completedBookingsCount;
        if (countDiff !== 0) return countDiff;
        return a.serviceName.localeCompare(b.serviceName);
      }),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    grossRevenueByCurrency,
    estimatedNetEarningsByCurrency,
    cancelledLostRevenueByCurrency,
    pendingRevenueByCurrency,
    averageBookingValueByCurrency,
    grossRevenueTodayByCurrency,
    grossRevenueThisMonthByCurrency,
    revenueByService,
  };
}
