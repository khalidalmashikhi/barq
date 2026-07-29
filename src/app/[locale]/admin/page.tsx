import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { ShieldCheck, ClipboardList, Loader2, XCircle, Star, UserPlus, Users, PackageX, CalendarOff, UserRound, Trophy, PenLine } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAdminOverview } from "@/lib/admin/get-admin-overview";
import { getProviderInsights } from "@/lib/admin/get-provider-insights";
import { getCustomers } from "@/lib/admin/get-customers";
import { getCustomersWithMostBookings, getCustomersAwaitingReviews } from "@/lib/admin/get-customer-insights";
import { AdminMetricsRow } from "@/components/admin/admin-metrics-row";
import { AdminQueueCard, type AdminQueueItem } from "@/components/admin/admin-queue-card";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Admin Overview — Admin Operations Platform.
//
// Replaces the previous bare "/admin -> /admin/providers" redirect
// with a genuine operational dashboard. This page itself does no
// Prisma calls — every number/list comes from the dedicated
// getAdminOverview()/getProviderInsights()/getCustomers()/
// getCustomersWithMostBookings()/getCustomersAwaitingReviews() query
// modules, run in parallel here via Promise.all. No existing admin
// route, page, or CRUD capability is touched — this is a new landing
// page above them, not a replacement for any of them.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminOverviewPage() {
  const t = await getServerTranslator("admin");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  let overview, providerInsights, recentCustomersResult, mostBookedCustomers, customersAwaitingReviews;
  try {
    [overview, providerInsights, recentCustomersResult, mostBookedCustomers, customersAwaitingReviews] = await Promise.all([
      getAdminOverview(),
      getProviderInsights(),
      getCustomers({ pageSize: 5 }),
      getCustomersWithMostBookings(),
      getCustomersAwaitingReviews(),
    ]);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const pendingProviderItems: AdminQueueItem[] = overview.pendingProviderApprovals.items.map((provider) => ({
    id: provider.id,
    href: `/admin/providers/${provider.id}`,
    primaryText: provider.businessName,
  }));

  const awaitingProviderItems: AdminQueueItem[] = overview.bookingsAwaitingProvider.items.map((booking) => ({
    id: booking.id,
    href: `/admin/bookings/${booking.id}`,
    primaryText: booking.serviceName,
    secondaryText: booking.providerName,
  }));

  const inProgressItems: AdminQueueItem[] = overview.bookingsInProgress.items.map((booking) => ({
    id: booking.id,
    href: `/admin/bookings/${booking.id}`,
    primaryText: booking.serviceName,
    secondaryText: booking.providerName,
  }));

  const recentlyCancelledItems: AdminQueueItem[] = overview.recentlyCancelled.items.map((booking) => ({
    id: booking.id,
    href: `/admin/bookings/${booking.id}`,
    primaryText: booking.serviceName,
    secondaryText: getBookingStatusLabel(booking.status, tBooking),
  }));

  const recentReviewItems: AdminQueueItem[] = overview.recentReviews.map((review) => ({
    id: review.id,
    href: "/admin/reviews",
    primaryText: review.serviceName,
    secondaryText: `${review.providerName} · ${review.rating}/5`,
  }));

  const providersWithoutServicesItems: AdminQueueItem[] = providerInsights.providersWithoutServices.map((provider) => ({
    id: provider.id,
    href: `/admin/providers/${provider.id}`,
    primaryText: provider.businessName,
  }));

  const providersNoCompletedBookingsItems: AdminQueueItem[] = providerInsights.providersWithNoCompletedBookings.map((provider) => ({
    id: provider.id,
    href: `/admin/providers/${provider.id}`,
    primaryText: provider.businessName,
  }));

  const providersNoRecentActivityItems: AdminQueueItem[] = providerInsights.providersWithNoRecentActivity.map((provider) => ({
    id: provider.id,
    href: `/admin/providers/${provider.id}`,
    primaryText: provider.businessName,
  }));

  const recentlyJoinedProviderItems: AdminQueueItem[] = overview.recentProviders.map((provider) => ({
    id: provider.id,
    href: `/admin/providers/${provider.id}`,
    primaryText: provider.businessName,
    secondaryText: formatDate(provider.createdAt, locale, { day: "numeric", month: "short", year: "numeric" }),
  }));

  const recentCustomerItems: AdminQueueItem[] = overview.recentCustomers.map((customer) => ({
    id: customer.id,
    href: `/admin/customers/${customer.id}`,
    primaryText: customer.phoneNumber,
    secondaryText: formatDate(customer.createdAt, locale, { day: "numeric", month: "short", year: "numeric" }),
  }));

  const mostBookedCustomerItems: AdminQueueItem[] = mostBookedCustomers.items.map((customer) => ({
    id: customer.id,
    href: `/admin/customers/${customer.id}`,
    primaryText: customer.phoneNumber,
    secondaryText: `${customer.bookingCount} ${t("metricCustomersBookingCountSuffixLabel")}`,
  }));

  const customersAwaitingReviewsItems: AdminQueueItem[] = customersAwaitingReviews.items.map((customer) => ({
    id: customer.id,
    href: `/admin/customers/${customer.id}`,
    primaryText: customer.phoneNumber,
  }));

  const latestBookingItems: AdminQueueItem[] = overview.latestBookings.map((booking) => ({
    id: booking.id,
    href: `/admin/bookings/${booking.id}`,
    primaryText: booking.serviceName,
    secondaryText: `${booking.providerName} · ${getBookingStatusLabel(booking.status, tBooking)}`,
  }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("overviewTitle")}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t("overviewDescription")}</p>
      </div>

      <AdminMetricsRow
        totalCustomers={overview.totalCustomers}
        totalProviders={overview.totalProviders}
        publishedServicesCount={overview.publishedServicesCount}
        activeBookings={overview.bookingStatusCounts.active}
        completedBookings={overview.bookingStatusCounts.completed}
        cancelledBookings={overview.bookingStatusCounts.cancelled}
        todaysBookingsCount={overview.todaysBookingsCount}
        publishedReviewCount={overview.publishedReviewCount}
        totalReviewCount={overview.totalReviewCount}
        averageRating={overview.averageRating}
        completedGrossRevenueByCurrency={overview.completedGrossRevenueByCurrency}
        databaseStatus={overview.databaseStatus}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/40">{t("operationalQueuesTitle")}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AdminQueueCard
            icon={ShieldCheck}
            title={t("queuePendingProviderApprovalsLabel")}
            count={overview.pendingProviderApprovals.count}
            items={pendingProviderItems}
            emptyMessage={t("queuePendingProviderApprovalsEmptyLabel")}
            viewAllHref="/admin/providers?status=APPLIED"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={ClipboardList}
            title={t("queueBookingsAwaitingProviderLabel")}
            count={overview.bookingsAwaitingProvider.count}
            items={awaitingProviderItems}
            emptyMessage={t("queueBookingsAwaitingProviderEmptyLabel")}
            viewAllHref="/admin/bookings?status=PENDING_PROVIDER"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={Loader2}
            title={t("queueBookingsInProgressLabel")}
            count={overview.bookingsInProgress.count}
            items={inProgressItems}
            emptyMessage={t("queueBookingsInProgressEmptyLabel")}
            viewAllHref="/admin/bookings?status=IN_PROGRESS"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={XCircle}
            title={t("queueRecentlyCancelledLabel")}
            count={overview.recentlyCancelled.count}
            items={recentlyCancelledItems}
            emptyMessage={t("queueRecentlyCancelledEmptyLabel")}
            viewAllHref="/admin/bookings?status=CANCELLED,REJECTED"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={Star}
            title={t("queueRecentReviewsLabel")}
            count={overview.publishedReviewCount}
            items={recentReviewItems}
            emptyMessage={t("queueRecentReviewsEmptyLabel")}
            viewAllHref="/admin/reviews"
            viewAllLabel={t("viewAllLabel")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/40">{t("providerOperationsTitle")}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AdminQueueCard
            icon={UserPlus}
            title={t("insightRecentlyJoinedProvidersLabel")}
            count={overview.recentProviders.length}
            items={recentlyJoinedProviderItems}
            emptyMessage={t("insightRecentlyJoinedProvidersEmptyLabel")}
            viewAllHref="/admin/providers"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={PackageX}
            title={t("insightProvidersWithoutServicesLabel")}
            count={providerInsights.providersWithoutServicesCount}
            items={providersWithoutServicesItems}
            emptyMessage={t("insightProvidersWithoutServicesEmptyLabel")}
            viewAllHref="/admin/providers"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={CalendarOff}
            title={t("insightProvidersNoCompletedBookingsLabel")}
            count={providerInsights.providersWithNoCompletedBookingsCount}
            items={providersNoCompletedBookingsItems}
            emptyMessage={t("insightProvidersNoCompletedBookingsEmptyLabel")}
            viewAllHref="/admin/providers"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={CalendarOff}
            title={t("insightProvidersNoRecentActivityLabel")}
            count={providerInsights.providersWithNoRecentActivityCount}
            items={providersNoRecentActivityItems}
            emptyMessage={t("insightProvidersNoRecentActivityEmptyLabel")}
            viewAllHref="/admin/providers"
            viewAllLabel={t("viewAllLabel")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/40">{t("customerOperationsTitle")}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AdminQueueCard
            icon={UserRound}
            title={t("insightRecentlyRegisteredCustomersLabel")}
            count={recentCustomersResult.totalCount}
            items={recentCustomerItems}
            emptyMessage={t("insightRecentlyRegisteredCustomersEmptyLabel")}
            viewAllHref="/admin/customers"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={Trophy}
            title={t("insightCustomersMostBookingsLabel")}
            count={mostBookedCustomerItems.length}
            items={mostBookedCustomerItems}
            emptyMessage={t("insightCustomersMostBookingsEmptyLabel")}
            viewAllHref="/admin/customers"
            viewAllLabel={t("viewAllLabel")}
          />
          <AdminQueueCard
            icon={PenLine}
            title={t("insightCustomersAwaitingReviewsLabel")}
            count={customersAwaitingReviews.count}
            items={customersAwaitingReviewsItems}
            emptyMessage={t("insightCustomersAwaitingReviewsEmptyLabel")}
            viewAllHref="/admin/customers"
            viewAllLabel={t("viewAllLabel")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/40">{t("latestBookingsTitle")}</h2>
        <AdminQueueCard
          icon={Users}
          title={t("latestBookingsTitle")}
          count={overview.latestBookings.length}
          items={latestBookingItems}
          emptyMessage={t("latestBookingsEmptyLabel")}
          viewAllHref="/admin/bookings"
          viewAllLabel={t("viewAllLabel")}
        />
      </section>
    </div>
  );
}
