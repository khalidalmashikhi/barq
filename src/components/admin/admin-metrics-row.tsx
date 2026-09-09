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

  // ADMIN MOBILE POLISH (§2) — deliberate three-tier hierarchy over the SAME real data:
  //   • PRIMARY business KPIs — value-dominant (size="lg").
  //   • OPERATIONAL metrics — labelled section, standard weight.
  //   • SYSTEM status (database) — a distinct compact status strip, NOT a KPI card, so it
  //     never visually competes with the marketplace metrics.
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard size="lg" label={t("metricTotalCustomersLabel")} value={String(totalCustomers)} icon={Users} />
        <StatCard size="lg" label={t("metricTotalProvidersLabel")} value={String(totalProviders)} icon={ShieldCheck} />
        <StatCard size="lg" label={t("metricPublishedServicesLabel")} value={String(publishedServicesCount)} icon={Compass} />
        <StatCard size="lg" label={t("metricActiveBookingsLabel")} value={String(activeBookings)} icon={CalendarClock} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{t("metricsOperationalLabel")}</span>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label={t("metricCompletedBookingsLabel")} value={String(completedBookings)} icon={CheckCircle2} />
          <StatCard label={t("metricCancelledBookingsLabel")} value={String(cancelledBookings)} icon={XCircle} />
          <StatCard label={t("metricTodaysBookingsLabel")} value={String(todaysBookingsCount)} icon={CalendarDays} />
          <StatCard label={t("metricPublishedReviewsLabel")} value={`${publishedReviewCount} / ${totalReviewCount}`} icon={Star} />
          <StatCard label={t("metricAverageRatingLabel")} value={averageRating !== null ? averageRating.toFixed(1) : "—"} icon={Star} />
          {completedGrossRevenueByCurrency.map((entry) => (
            <StatCard key={entry.currency} label={t("metricCompletedGrossRevenueLabel")} value={`${entry.amount} ${entry.currency}`} icon={TrendingUp} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
        <Database size={15} strokeWidth={1.75} className="shrink-0 text-foreground/60" aria-hidden />
        <span className="text-foreground/70">{t("metricDatabaseConnectivityLabel")}</span>
        <span className="ms-auto inline-flex items-center gap-1.5 font-medium">
          <span className={`h-2 w-2 rounded-full ${databaseStatus === "ok" ? "bg-success" : "bg-danger"}`} aria-hidden />
          <span className={databaseStatus === "ok" ? "text-success" : "text-danger"}>
            {databaseStatus === "ok" ? t("databaseStatusOkLabel") : t("databaseStatusErrorLabel")}
          </span>
        </span>
      </div>
    </div>
  );
}
