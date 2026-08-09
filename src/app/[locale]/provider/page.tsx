import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Package,
  Clock,
  Briefcase,
  FileEdit,
  ClipboardList,
  PercentCircle,
  XCircle,
  Wallet,
  Gauge,
  CalendarClock,
  CalendarDays,
  Star,
  MessageSquareText,
  XOctagon,
} from "lucide-react";
import { redirect, getPathname } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderOverview } from "@/lib/provider/queries/get-provider-overview";
import { getProviderMetrics } from "@/lib/provider/queries/get-provider-metrics";
import { getProviderReviewsSummary, isHighRatedMilestone } from "@/lib/provider/queries/get-provider-reviews-summary";
import { getProviderServiceInsights } from "@/lib/provider/queries/get-provider-service-insights";
import { getProviderVerificationData } from "@/lib/provider/documents/get-provider-verification-data";
import { getNotifications } from "@/lib/notifications/get-notifications";
import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { StatCard } from "@/components/dashboard/stat-card";
import { ProviderRecentActivity } from "@/components/provider/recent-activity";
import { KpiCard } from "@/components/provider/kpi-card";
import { BookingPreviewList } from "@/components/provider/booking-preview-list";
import { CapacityAlerts } from "@/components/provider/capacity-alerts";
import { TopServices } from "@/components/provider/top-services";
import { QuickActions } from "@/components/provider/quick-actions";
import { BookingStatusBreakdown } from "@/components/provider/booking-status-breakdown";
import { RecentReviews } from "@/components/provider/recent-reviews";
import { ServiceInsights } from "@/components/provider/service-insights";
import { NotificationsPanel } from "@/components/provider/notifications-panel";
import { Alert } from "@/components/ui/alert";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Provider Dashboard — Phase 1a (Overview), redesigned Phase F.3
// (Provider Experience & Marketplace Excellence).
//
// SIMPLIFIED (Phase 1b, layout.tsx introduced): this page no longer
// performs its own auth-gate or AppShell wrapping — src/app/provider/
// layout.tsx now owns both for the entire /provider/* route tree.
// getProviderOverview() still independently resolves and re-verifies
// provider.id via its own requireProvider() call (Security Hardening
// pass) — this page never supplies or trusts a provider identity on
// its behalf, regardless of what the layout already checked.
//
// Phase C.3 Group 2 — CRITICAL FIX: that independent requireProvider()
// re-check throws UnauthenticatedError/ForbiddenError, which this page
// never caught — verified live: an authenticated non-Provider still
// ends up on the correct 404 (the layout's own check wins), but this
// page's own throw was surfacing as an uncaught server-log error in
// the meantime. Now caught here with the exact same handling
// src/app/[locale]/provider/layout.tsx already uses for the identical
// error, so there is nothing left uncaught between the two checks.
//
// PHASE F.3 — every KPI/rate/revenue figure below comes from
// getProviderMetrics() (new this phase, src/lib/provider/queries/
// get-provider-metrics.ts) — real Prisma aggregates (groupBy/sum) over
// existing Booking/Availability columns, never a fabricated number.
// Completion/cancellation rates and occupancy render an honest "—"
// (not "0%") when there is no data yet to compute them from.
export default async function ProviderOverviewPage() {
  const locale = await getLocale();

  let data;
  let metrics;
  let reviewsSummary;
  let serviceInsights;
  let unreadNotificationsCount;
  let recentNotifications;
  try {
    [data, metrics, reviewsSummary, serviceInsights, unreadNotificationsCount, recentNotifications] = await Promise.all([
      getProviderOverview(),
      getProviderMetrics(),
      getProviderReviewsSummary(),
      getProviderServiceInsights(),
      getUnreadCount(),
      getNotifications({ pageSize: 5 }).then((result) => result.items),
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

  const t = await getServerTranslator("provider");
  const bookingsPath = getPathname({ href: "/provider/bookings", locale });
  const pendingBookingsPath = `${bookingsPath}?status=PENDING_PROVIDER`;
  const verificationPath = getPathname({ href: "/provider/verification", locale });

  // Verification readiness (Gate 3) — advisory card only, derived from the same
  // requirement primitives. Isolated so it can NEVER break the dashboard.
  let verification: Awaited<ReturnType<typeof getProviderVerificationData>> | null = null;
  try {
    verification = await getProviderVerificationData();
  } catch {
    verification = null;
  }

  const formatRate = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
  const averageRatingValue = reviewsSummary.averageRating !== null ? reviewsSummary.averageRating.toFixed(1) : "—";
  const highRatedMilestone = isHighRatedMilestone(reviewsSummary)
    ? { averageRating: reviewsSummary.averageRating as number, reviewCount: reviewsSummary.reviewCount }
    : undefined;

  const primaryRevenue = metrics.totalRevenueByCurrency[0];
  const revenueValue = primaryRevenue ? `${primaryRevenue.amount} ${primaryRevenue.currency}` : "—";
  const revenueHelpText =
    metrics.totalRevenueByCurrency.length > 1
      ? t("revenueAdditionalCurrenciesLabel", { count: metrics.totalRevenueByCurrency.length - 1 })
      : metrics.totalRevenueByCurrency.length === 0
        ? t("noCompletedBookingsLabel")
        : undefined;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
      <div className="bg-luxury-gradient rounded-3xl px-8 py-10 shadow-premium-lg">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">{t("overviewTitle")}</h1>
        <p className="mt-2 max-w-xl text-sm text-white/75">{t("overviewSubtitle")}</p>
      </div>

      {data.pendingConfirmationsCount > 0 && (
        <Alert variant="warning">
          {t("pendingConfirmationsAlert", { count: data.pendingConfirmationsCount })}{" "}
          <Link href={pendingBookingsPath} className="font-medium underline underline-offset-2">
            {t("reviewNowLabel")}
          </Link>
        </Alert>
      )}

      {verification && verification.requiredTotal > 0 && verification.requiredApproved < verification.requiredTotal && (
        <Alert variant="info">
          {t("verificationReadinessAlert", {
            approved: verification.requiredApproved,
            total: verification.requiredTotal,
          })}{" "}
          <Link href={verificationPath} className="font-medium underline underline-offset-2">
            {t("verificationCtaLabel")}
          </Link>
        </Alert>
      )}

      <CapacityAlerts items={data.capacityAlerts} availabilityHref="/provider/availability" />

      <NotificationsPanel
        unreadCount={unreadNotificationsCount}
        items={recentNotifications}
        viewAllHref="/provider/notifications"
        highRatedMilestone={highRatedMilestone}
      />

      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground/60">{t("kpiSectionTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard label={t("totalBookingsLabel")} value={String(metrics.totalBookingsCount)} icon={ClipboardList} />
          <KpiCard label={t("activeServicesLabel")} value={String(data.publishedServicesCount)} icon={Package} />
          <KpiCard
            label={t("completionRateLabel")}
            value={formatRate(metrics.completionRate)}
            icon={PercentCircle}
            tone={metrics.completionRate !== null && metrics.completionRate >= 0.5 ? "success" : "default"}
          />
          <KpiCard
            label={t("cancellationRateLabel")}
            value={formatRate(metrics.cancellationRate)}
            icon={XCircle}
            tone={metrics.cancellationRate !== null && metrics.cancellationRate > 0 ? "danger" : "default"}
          />
          <KpiCard label={t("revenueLabel")} value={revenueValue} icon={Wallet} helpText={revenueHelpText} />
          <KpiCard
            label={t("averageRatingLabel")}
            value={averageRatingValue}
            icon={Star}
            helpText={reviewsSummary.reviewCount === 0 ? t("noRatingsLabel") : undefined}
          />
          <KpiCard label={t("reviewCountLabel")} value={String(reviewsSummary.reviewCount)} icon={MessageSquareText} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label={t("draftServicesLabel")} value={String(data.draftServicesCount)} icon={FileEdit} />
        <StatCard label={t("openSlotsLabel")} value={String(data.upcomingOpenSlotsCount)} icon={Clock} />
        <StatCard label={t("occupancyLabel")} value={formatRate(metrics.occupancyRate)} icon={Gauge} />
        <StatCard label={t("activeBookingsLabel")} value={String(data.activeBookingsCount)} icon={Briefcase} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BookingPreviewList
          title={t("todayBookingsLabel")}
          icon={CalendarClock}
          items={data.todaysBookings}
          emptyMessage={t("noTodayBookingsLabel")}
          viewAllHref="/provider/bookings"
          viewAllLabel={t("viewAllLabel")}
        />
        <BookingPreviewList
          title={t("upcomingBookingsLabel")}
          icon={CalendarDays}
          items={data.upcomingBookings}
          emptyMessage={t("noUpcomingBookingsLabel")}
          viewAllHref="/provider/bookings"
          viewAllLabel={t("viewAllLabel")}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BookingStatusBreakdown items={metrics.bookingsByStatus} />
        <ServiceInsights needingAttention={serviceInsights.needingAttention} lowActivity={serviceInsights.lowActivity} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TopServices items={metrics.topServices} />
        <QuickActions />
      </div>

      <RecentReviews items={reviewsSummary.recentReviews} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ProviderRecentActivity items={data.recentActivity} />
        <ProviderRecentActivity
          items={data.recentlyCancelledBookings}
          title={t("recentlyCancelledTitle")}
          icon={XOctagon}
          emptyMessage={t("noCancelledBookingsLabel")}
        />
      </div>
    </div>
  );
}
