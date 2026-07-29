import { Users, ShieldCheck, Compass, CalendarClock, CheckCircle2, XCircle, Star, TrendingUp, CalendarDays, Database } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import type { CurrencyAmount } from "@/lib/provider/queries/get-provider-earnings";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Admin platform metrics row — Admin Operations Platform.
//
// EVERY VALUE IS REAL, ALREADY-COMPUTED DATA passed in from
// getAdminOverview()'s own Prisma aggregates — this component only
// lays out the pre-existing StatCard primitive (same one the Customer
// dashboard already uses), never a new visual language, never a
// client-side calculation.
//
// completedGrossRevenueByCurrency renders one card PER currency
// present — never summed/converted across currencies (see
// get-admin-overview.ts's own header comment for why).
// averageRating is null-safe: "—" when there are zero PUBLISHED
// reviews, never a misleading 0.

type AdminMetricsRowProps = {
  totalCustomers: number;
  totalProviders: number;
  publishedServicesCount: number;
  activeBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  todaysBookingsCount: number;
  publishedReviewCount: number;
  totalReviewCount: number;
  averageRating: number | null;
  completedGrossRevenueByCurrency: CurrencyAmount[];
  databaseStatus: "ok" | "error";
};

export async function AdminMetricsRow({
  totalCustomers,
  totalProviders,
  publishedServicesCount,
  activeBookings,
  completedBookings,
  cancelledBookings,
  todaysBookingsCount,
  publishedReviewCount,
  totalReviewCount,
  averageRating,
  completedGrossRevenueByCurrency,
  databaseStatus,
}: AdminMetricsRowProps) {
  const t = await getServerTranslator("admin");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("metricTotalCustomersLabel")} value={String(totalCustomers)} icon={Users} />
        <StatCard label={t("metricTotalProvidersLabel")} value={String(totalProviders)} icon={ShieldCheck} />
        <StatCard label={t("metricPublishedServicesLabel")} value={String(publishedServicesCount)} icon={Compass} />
        <StatCard label={t("metricActiveBookingsLabel")} value={String(activeBookings)} icon={CalendarClock} />
        <StatCard label={t("metricCompletedBookingsLabel")} value={String(completedBookings)} icon={CheckCircle2} />
        <StatCard label={t("metricCancelledBookingsLabel")} value={String(cancelledBookings)} icon={XCircle} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("metricTodaysBookingsLabel")} value={String(todaysBookingsCount)} icon={CalendarDays} />
        <StatCard
          label={t("metricPublishedReviewsLabel")}
          value={`${publishedReviewCount} / ${totalReviewCount}`}
          icon={Star}
        />
        <StatCard label={t("metricAverageRatingLabel")} value={averageRating !== null ? averageRating.toFixed(1) : "—"} icon={TrendingUp} />
        {completedGrossRevenueByCurrency.map((entry) => (
          <StatCard
            key={entry.currency}
            label={t("metricCompletedGrossRevenueLabel")}
            value={`${entry.amount} ${entry.currency}`}
            icon={TrendingUp}
          />
        ))}
        <StatCard
          label={t("metricDatabaseConnectivityLabel")}
          value={databaseStatus === "ok" ? t("databaseStatusOkLabel") : t("databaseStatusErrorLabel")}
          icon={Database}
        />
      </div>
    </div>
  );
}
