import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { foldBookingStatusCounts, type FoldedBookingStatusCounts } from "@/lib/dashboard/fold-booking-status-counts";
import { checkDatabaseHealth } from "@/lib/observability/check-database-health";
import { getPendingProviders, type PendingProviderListItem } from "@/lib/admin/get-pending-providers";
import { getBookings, type BookingAdminListItem } from "@/lib/admin/get-bookings";
import { getOmanTodayRangeUtc } from "@/lib/provider/queries/get-provider-overview";
import type { CurrencyAmount } from "@/lib/provider/queries/get-provider-earnings";

// Admin Overview aggregate query — Admin Operations Platform.
//
// ONE ENTRY POINT for the /admin dashboard: the page component calls
// only this function, never assembles raw Prisma calls itself
// ("prefer one dedicated admin overview query module" — this phase's
// own instruction). Internally this composes independent queries via a
// single Promise.all — both plain Prisma aggregates defined directly
// here, and calls into already-existing, already-guarded admin query
// functions (getPendingProviders/getBookings) so the exact same
// business definitions are reused rather than re-derived.
//
// METRIC DEFINITIONS (all explicit, none silent):
//
// - Total Customers = count of Customer PROFILES (`prisma.customer.count()`),
//   never generic User rows — a User may exist without ever completing
//   customer self-provisioning.
// - Total Providers = count of Provider profiles (`prisma.provider.count()`).
// - Published Services = `service.count({status:"PUBLISHED"})`, the
//   exact same ServiceStatus value every other admin/provider surface
//   already treats as "live to customers."
// - Booking status breakdown reuses foldBookingStatusCounts() directly
//   against a platform-wide (no providerId/customerId scope)
//   groupBy(by:["status"]) — Active=CONFIRMED+IN_PROGRESS,
//   Completed=COMPLETED, Cancelled=CANCELLED+REJECTED (the same
//   combination already approved for the Customer dashboard and the
//   Provider Earnings phase's "Cancelled/Lost Revenue" bucket — reused
//   for consistency, not re-decided). Missing statuses fold to zero.
// - Reviews: totalReviewCount counts every Review row regardless of
//   moderationState; publishedReviewCount and averageRating are both
//   scoped to moderationState:"PUBLISHED" only — the two counts are
//   never mixed into one number, so a reader can always see how many
//   (if any) reviews exist outside the public-facing set.
// - Completed Gross Revenue: COMPLETED bookings only, grouped by
//   priceSnapshotCurrency, each currency's sum kept separate — never
//   merged, never converted, never called "profit"/"payout"/
//   "settlement." Mirrors get-provider-earnings.ts's own
//   grossRevenueByCurrency exactly, just without a providerId filter.
// - Today's Bookings = bookings whose `createdAt` falls within Oman's
//   current calendar day (reuses getOmanTodayRangeUtc() from
//   get-provider-overview.ts) — this counts new booking REQUESTS made
//   today, not bookings whose event happens today and not any other
//   "recent" window; kept in its own section, never merged with
//   "Recent"-labeled sections that use a different, unbounded-by-day
//   ordering instead of a real date range.
// - Recent Registrations / Latest Bookings / Recent Reviews are each
//   the most recent N rows by `createdAt` — no day-window, just
//   recency order, labeled "Recent"/"Latest," never "Today's."
// - Recently Cancelled queue: CANCELLED or REJECTED bookings whose
//   `updatedAt` is within the last 30 days (documented window,
//   consistent with the Provider "No Recent Booking Activity" rule's
//   own use of `updatedAt` as the best available activity timestamp —
//   Booking has no dedicated `cancelledAt` field).
// - Database Connectivity: a real `SELECT 1` via the shared
//   checkDatabaseHealth() helper — proves reachability only, never
//   called "System Health"/"Platform Health."

const RECENT_LIMIT = 5;
const RECENTLY_CANCELLED_WINDOW_DAYS = 30;

export type AdminOverviewRecentCustomer = { id: string; phoneNumber: string | null; createdAt: Date };
export type AdminOverviewRecentProvider = { id: string; businessName: string; createdAt: Date };
export type AdminOverviewRecentReview = {
  id: string;
  providerName: string;
  serviceName: string;
  rating: number;
  content: string;
  createdAt: Date;
};

export type AdminOverviewData = {
  totalCustomers: number;
  totalProviders: number;
  publishedServicesCount: number;
  bookingStatusCounts: FoldedBookingStatusCounts;
  totalReviewCount: number;
  publishedReviewCount: number;
  averageRating: number | null;
  completedGrossRevenueByCurrency: CurrencyAmount[];
  databaseStatus: "ok" | "error";
  todaysBookingsCount: number;
  recentCustomers: AdminOverviewRecentCustomer[];
  recentProviders: AdminOverviewRecentProvider[];
  latestBookings: BookingAdminListItem[];
  recentReviews: AdminOverviewRecentReview[];
  pendingProviderApprovals: { items: PendingProviderListItem[]; count: number };
  bookingsAwaitingProvider: { items: BookingAdminListItem[]; count: number };
  bookingsInProgress: { items: BookingAdminListItem[]; count: number };
  recentlyCancelled: { items: BookingAdminListItem[]; count: number };
};

export async function getAdminOverview(): Promise<AdminOverviewData> {
  await requireAdmin();
  const locale = await getLocale();
  const fallbackServiceName = locale === "ar" ? "تجربة" : "Experience";
  const fallbackProviderName = locale === "ar" ? "مزود خدمة" : "Service Provider";

  const now = new Date();
  const { start: todayStart, end: todayEnd } = getOmanTodayRangeUtc(now);
  const recentlyCancelledSince = new Date(now.getTime() - RECENTLY_CANCELLED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    totalCustomers,
    totalProviders,
    publishedServicesCount,
    statusCountRows,
    totalReviewCount,
    publishedReviewCount,
    ratingAggregate,
    revenueRows,
    databaseStatus,
    todaysBookingsCount,
    recentCustomerRows,
    recentProviderRows,
    latestBookingsResult,
    recentReviewRows,
    pendingProviders,
    bookingsAwaitingProviderResult,
    bookingsInProgressResult,
    recentlyCancelledResult,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.provider.count(),
    prisma.service.count({ where: { status: "PUBLISHED" } }),
    prisma.booking.groupBy({ by: ["status"], _count: true }),
    prisma.review.count(),
    prisma.review.count({ where: { moderationState: "PUBLISHED" } }),
    prisma.rating.aggregate({
      where: { review: { moderationState: "PUBLISHED" } },
      _avg: { value: true },
    }),
    prisma.booking.groupBy({
      by: ["priceSnapshotCurrency"],
      where: { status: "COMPLETED", priceSnapshotAmount: { not: null } },
      _sum: { priceSnapshotAmount: true },
    }),
    checkDatabaseHealth(),
    prisma.booking.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } }),
    prisma.customer.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_LIMIT,
      select: { id: true, createdAt: true, user: { select: { phoneNumber: true } } },
    }),
    prisma.provider.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_LIMIT,
      select: { id: true, createdAt: true, businessName: true },
    }),
    getBookings({ pageSize: RECENT_LIMIT }),
    prisma.review.findMany({
      where: { moderationState: "PUBLISHED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_LIMIT,
      include: { rating: true, provider: { select: { businessName: true } }, booking: { select: { service: { select: { name: true } } } } },
    }),
    getPendingProviders(),
    getBookings({ status: "PENDING_PROVIDER", pageSize: RECENT_LIMIT }),
    getBookings({ status: "IN_PROGRESS", pageSize: RECENT_LIMIT }),
    getBookings({ status: ["CANCELLED", "REJECTED"], updatedAfter: recentlyCancelledSince, pageSize: RECENT_LIMIT }),
  ]);

  type ReviewRow = {
    id: string;
    content: string;
    createdAt: Date;
    rating: { value: number } | null;
    provider: { businessName: unknown };
    booking: { service: { name: unknown } };
  };

  const recentCustomers: AdminOverviewRecentCustomer[] = recentCustomerRows.map((row) => ({
    id: row.id,
    phoneNumber: row.user.phoneNumber,
    createdAt: row.createdAt,
  }));

  const recentProviders: AdminOverviewRecentProvider[] = recentProviderRows.map((row) => ({
    id: row.id,
    businessName: extractLocalizedText(row.businessName, locale) || fallbackProviderName,
    createdAt: row.createdAt,
  }));

  const recentReviews: AdminOverviewRecentReview[] = (recentReviewRows as ReviewRow[]).map((review) => ({
    id: review.id,
    providerName: extractLocalizedText(review.provider.businessName, locale) || fallbackProviderName,
    serviceName: extractLocalizedText(review.booking.service.name, locale) || fallbackServiceName,
    rating: review.rating?.value ?? 0,
    content: review.content,
    createdAt: review.createdAt,
  }));

  const completedGrossRevenueByCurrency: CurrencyAmount[] = revenueRows
    .filter((row) => row.priceSnapshotCurrency && row._sum.priceSnapshotAmount !== null)
    .map((row) => ({ amount: String(row._sum.priceSnapshotAmount), currency: row.priceSnapshotCurrency as string }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    totalCustomers,
    totalProviders,
    publishedServicesCount,
    bookingStatusCounts: foldBookingStatusCounts(statusCountRows),
    totalReviewCount,
    publishedReviewCount,
    averageRating: ratingAggregate._avg.value,
    completedGrossRevenueByCurrency,
    databaseStatus,
    todaysBookingsCount,
    recentCustomers,
    recentProviders,
    latestBookings: latestBookingsResult.items,
    recentReviews,
    pendingProviderApprovals: { items: pendingProviders.slice(0, RECENT_LIMIT), count: pendingProviders.length },
    bookingsAwaitingProvider: { items: bookingsAwaitingProviderResult.items, count: bookingsAwaitingProviderResult.totalCount },
    bookingsInProgress: { items: bookingsInProgressResult.items, count: bookingsInProgressResult.totalCount },
    recentlyCancelled: { items: recentlyCancelledResult.items, count: recentlyCancelledResult.totalCount },
  };
}
