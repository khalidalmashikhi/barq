import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertNotActiveAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { resolveHeadlinePrice } from "@/lib/services/headline-price";
import { deriveBookability, type Bookability } from "@/lib/services/bookability";
import { getServiceSlotFacts } from "@/lib/services/bookability-facts";
import type { Locale } from "@/i18n/locales";
import { foldBookingStatusCounts, type FoldedBookingStatusCounts } from "./fold-booking-status-counts";

// Deterministic headline (min within primary currency) + shared bookability, batched over
// a small set of services — the same truthful discovery presentation the storefront uses.
const ACTIVE_PRICE_INCLUDE = {
  where: { status: "ACTIVE" as const },
  orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  select: { id: true, amount: true, currency: true, pricingUnit: true, createdAt: true },
};

async function toDashboardServices(services: ServiceWithJoins[], locale: Locale): Promise<DashboardFeaturedService[]> {
  const slotFacts = await getServiceSlotFacts(services.map((s) => s.id));
  return services.map((service) => {
    const headline = resolveHeadlinePrice(
      service.prices.map((p) => ({ id: p.id, amount: p.amount as Prisma.Decimal, currency: p.currency, pricingUnit: p.pricingUnit ?? null, createdAt: p.createdAt }))
    );
    return {
      id: service.id,
      name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
      providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
      price: headline ? `${headline.amount} ${headline.currency}` : null,
      priceIsFrom: headline?.isFrom ?? false,
      bookability: deriveBookability({
        hasActivePrice: headline !== null,
        requiresSlot: slotFacts.requiresSlot.has(service.id),
        hasBookableSlot: slotFacts.hasBookableSlot.has(service.id),
      }),
    };
  });
}

// Dashboard data fetching — Engineering Sprint (Dashboard Data Wiring).
//
// Deliberately separate from src/lib/auth/rbac.ts — this module only
// reads dashboard-relevant data given an already-authenticated
// barqUserId; it does not touch session resolution, role checks, or
// any RBAC logic, per explicit instruction not to modify RBAC.
//
// HANDLES THE NO-CUSTOMER-PROFILE CASE EXPLICITLY: a BARQ User can
// exist with no Customer/Provider/Staff/Admin sub-profile at all (per
// DOMAIN_MODEL.md) — a newly authenticated user who has never made a
// booking. Every query below returns an honest empty/zero result for
// that case rather than erroring, per explicit task requirement #7.

export type DashboardBookingSummary = {
  id: string;
  serviceName: string;
  status: string;
  confirmedAt: Date | null;
};

/// Customer Experience Platform — a real Booking row for the "Recent
/// Bookings" list, ordered by createdAt (when the request was made),
/// distinct from DashboardBookingSummary (confirmedAt-ordered, CONFIRMED-
/// only "upcoming trips" list) since this one spans every status.
export type DashboardRecentBookingItem = {
  id: string;
  serviceName: string;
  status: string;
  priceSnapshot: string | null;
  createdAt: Date;
};

export type DashboardFeaturedService = {
  id: string;
  name: string;
  providerName: string;
  price: string | null;
  /// Deterministic headline min ("From" when a floor) + shared bookability — same
  /// truthful discovery semantics as the public storefront cards.
  priceIsFrom: boolean;
  bookability: Bookability;
};

export type DashboardData = {
  hasCustomerProfile: boolean;
  activeBookingsCount: number;
  upcomingBookingsCount: number;
  notificationsCount: number;
  upcomingBookings: DashboardBookingSummary[];
  featuredServices: DashboardFeaturedService[];
  mostBookedServices: DashboardFeaturedService[];
  /// Customer Experience Platform — real groupBy(by:["status"]), folded
  /// via the pure foldBookingStatusCounts() helper (see that file for
  /// the documented active/cancelled definitions). Missing statuses are
  /// zero, never undefined.
  bookingStatusCounts: FoldedBookingStatusCounts;
  /// Real count of this customer's own written Review rows.
  reviewsGivenCount: number;
  /// Real count of COMPLETED bookings with no Review yet — computed
  /// live on every render, never persisted, per this phase's "no
  /// fabricated data" requirement.
  awaitingReviewCount: number;
  /// Real, most-recently-created bookings (any status) — labeled
  /// "Recent Bookings," deliberately not "Recent Activity": this is a
  /// list of Booking rows ordered by createdAt, not a multi-event
  /// activity/audit source (that would be a different, unbuilt
  /// feature — see ActivityFeed's own honest-empty-state comment,
  /// left untouched by this phase).
  recentBookings: DashboardRecentBookingItem[];
};

// Minimal local type for Service query results with provider/prices
// joined — @prisma/client's generated types are unresolvable in this
// sandbox (no network access to install it), so this is hand-typed
// rather than inferred, matching only the fields actually consumed
// below. Hoisted here once rather than duplicated in both functions
// that need it.
type ServiceWithJoins = {
  id: string;
  name: unknown;
  provider: { businessName: unknown };
  prices: Array<{ id: string; amount: unknown; currency: string; pricingUnit?: string | null; createdAt: Date }>;
};

export async function getDashboardData(barqUserId: string): Promise<DashboardData> {
  // Gate A (domain-layer authorization): an ACTIVE Admin is backoffice-only and
  // must not obtain Customer dashboard data, even its own. This function receives
  // an already-resolved barqUserId (its page caller runs requireAuth + redirects
  // active admins), but the exclusion is enforced HERE too so a direct call from
  // the BARQ API/iOS/Android or another server action is denied identically.
  await assertNotActiveAdmin(barqUserId);
  const locale = await getLocale();

  const customer = await prisma.customer.findUnique({
    where: { userId: barqUserId },
  });

  const notificationsCount = await prisma.notification.count({
    where: { userId: barqUserId },
  });

  if (!customer) {
    // Honest empty state — no fabricated numbers for a user with no
    // Customer profile yet, per explicit requirement #7.
    const [featuredServices, mostBookedServices] = await Promise.all([
      getFeaturedServices(locale),
      getMostBookedServices(locale),
    ]);
    return {
      hasCustomerProfile: false,
      activeBookingsCount: 0,
      upcomingBookingsCount: 0,
      notificationsCount,
      upcomingBookings: [],
      featuredServices,
      mostBookedServices,
      bookingStatusCounts: { total: 0, active: 0, completed: 0, cancelled: 0 },
      reviewsGivenCount: 0,
      awaitingReviewCount: 0,
      recentBookings: [],
    };
  }

  const [
    activeBookingsCount,
    upcomingBookingsRaw,
    featuredServices,
    mostBookedServices,
    statusCountRows,
    reviewsGivenCount,
    awaitingReviewCount,
    recentBookingsRaw,
  ] = await Promise.all([
    prisma.booking.count({
      where: {
        customerId: customer.id,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
    }),
    prisma.booking.findMany({
      where: {
        customerId: customer.id,
        status: "CONFIRMED",
      },
      orderBy: { confirmedAt: "asc" },
      take: 5,
      include: { service: true },
    }),
    getFeaturedServices(locale),
    getMostBookedServices(locale),
    // Customer Experience Platform — one groupBy answers Total/
    // Completed/Cancelled all at once, folded via the pure
    // foldBookingStatusCounts() helper below. Kept as its own query,
    // never merged with the review counts that follow (a booking-count
    // query and a review-count query are deliberately separate
    // abstractions, per this phase's own instruction).
    prisma.booking.groupBy({
      by: ["status"],
      where: { customerId: customer.id },
      _count: true,
    }),
    prisma.review.count({ where: { customerId: customer.id } }),
    // "Awaiting Review" — COMPLETED bookings this customer has not yet
    // reviewed. Computed live on every render (never persisted), same
    // "opt-in visibility" computed-condition convention already used by
    // the Provider dashboard's ServiceInsights/CapacityAlerts.
    prisma.booking.count({
      where: { customerId: customer.id, status: "COMPLETED", review: null },
    }),
    prisma.booking.findMany({
      where: { customerId: customer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      include: { service: true },
    }),
  ]);

  const upcomingBookings: DashboardBookingSummary[] = upcomingBookingsRaw.map(
    (booking: { id: string; status: string; confirmedAt: Date | null; service: { name: unknown } }) => ({
      id: booking.id,
      serviceName: extractLocalizedText(booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
      status: booking.status,
      confirmedAt: booking.confirmedAt,
    })
  );

  type RecentBookingRow = {
    id: string;
    status: string;
    priceSnapshotAmount: unknown;
    priceSnapshotCurrency: string | null;
    createdAt: Date;
    service: { name: unknown };
  };

  const recentBookings: DashboardRecentBookingItem[] = (recentBookingsRaw as RecentBookingRow[]).map((booking) => ({
    id: booking.id,
    serviceName: extractLocalizedText(booking.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    status: booking.status,
    priceSnapshot:
      booking.priceSnapshotAmount !== null && booking.priceSnapshotCurrency
        ? `${booking.priceSnapshotAmount} ${booking.priceSnapshotCurrency}`
        : null,
    createdAt: booking.createdAt,
  }));

  return {
    hasCustomerProfile: true,
    activeBookingsCount,
    upcomingBookingsCount: upcomingBookings.length,
    notificationsCount,
    upcomingBookings,
    featuredServices,
    mostBookedServices,
    bookingStatusCounts: foldBookingStatusCounts(statusCountRows),
    reviewsGivenCount,
    awaitingReviewCount,
    recentBookings,
  };
}

async function getMostBookedServices(locale: Locale): Promise<DashboardFeaturedService[]> {
  // Real aggregation over existing Booking/Service data — a GROUP BY +
  // COUNT, not an invented recommendation feature. Excludes CANCELLED
  // so a service isn't "most booked" on the back of cancellations.
  const grouped = await prisma.booking.groupBy({
    by: ["serviceId"],
    where: { status: { not: "CANCELLED" } },
    _count: { serviceId: true },
    orderBy: { _count: { serviceId: "desc" } },
    take: 5,
  });

  if (grouped.length === 0) return [];

  const services = await prisma.service.findMany({
    // Truthfulness — only PUBLISHED services from APPROVED, visible providers count as a
    // recommendation. A most-booked service whose provider was later hidden/suspended is
    // dropped rather than shown as bookable (same gate the storefront applies).
    where: {
      id: { in: grouped.map((g: { serviceId: string }) => g.serviceId) },
      status: "PUBLISHED",
      provider: { status: "APPROVED", visible: true },
    },
    include: { provider: true, prices: ACTIVE_PRICE_INCLUDE },
  });

  const serviceById = new Map(services.map((s: ServiceWithJoins) => [s.id, s]));

  const ordered = grouped
    .map((g: { serviceId: string }) => serviceById.get(g.serviceId))
    .filter((service: ServiceWithJoins | undefined): service is ServiceWithJoins => Boolean(service));
  return toDashboardServices(ordered, locale);
}

async function getFeaturedServices(locale: Locale): Promise<DashboardFeaturedService[]> {
  const services = await prisma.service.findMany({
    // Same provider-visibility gate as the public storefront (previously only status was
    // filtered, so a hidden provider's service could appear as featured).
    where: { status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
    take: 6,
    orderBy: { createdAt: "desc" },
    include: { provider: true, prices: ACTIVE_PRICE_INCLUDE },
  });

  return toDashboardServices(services as ServiceWithJoins[], locale);
}
