import { ClipboardList, CalendarClock, CheckCircle2, XCircle, Star, PenLine, Bell } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";

// Customer KPI row — Customer Experience Platform.
//
// EVERY VALUE IS REAL, ALREADY-COMPUTED DATA — no rate, total, or count
// is invented here; all seven numbers are passed in from
// getDashboardData()'s own real Prisma aggregates (a single
// groupBy(by:["status"]) folded via foldBookingStatusCounts(), plus
// two plain counts for reviews given/awaiting review, plus the
// pre-existing real notificationsCount). This component only lays out
// StatCard — the same small "glass" stat primitive already used
// elsewhere on this page — never a new visual language.
//
// METRIC DEFINITIONS, DOCUMENTED (see fold-booking-status-counts.ts for
// the full rationale): Active/Upcoming = CONFIRMED + IN_PROGRESS,
// reusing the exact set this dashboard's own activeBookingsCount has
// always used. Cancelled = CANCELLED + REJECTED, a deliberate choice
// matching the Earnings phase's own "Cancelled / Lost Revenue"
// precedent. Total counts every status, including ones with no
// dedicated card here (PENDING_PROVIDER/CREATED/DISPUTED/EXPIRED).

type CustomerKpiRowProps = {
  totalBookings: number;
  activeBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  reviewsGiven: number;
  awaitingReview: number;
  unreadNotifications: number;
};

export async function CustomerKpiRow({
  totalBookings,
  activeBookings,
  completedBookings,
  cancelledBookings,
  reviewsGiven,
  awaitingReview,
  unreadNotifications,
}: CustomerKpiRowProps) {
  const t = await getServerTranslator("dashboard");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label={t("kpiTotalBookingsLabel")} value={String(totalBookings)} icon={ClipboardList} />
      <StatCard label={t("kpiActiveBookingsLabel")} value={String(activeBookings)} icon={CalendarClock} />
      <StatCard label={t("kpiCompletedBookingsLabel")} value={String(completedBookings)} icon={CheckCircle2} />
      <StatCard label={t("kpiCancelledBookingsLabel")} value={String(cancelledBookings)} icon={XCircle} />
      <StatCard label={t("kpiReviewsGivenLabel")} value={String(reviewsGiven)} icon={Star} />
      <StatCard label={t("kpiAwaitingReviewLabel")} value={String(awaitingReview)} icon={PenLine} />
      <StatCard label={t("kpiUnreadNotificationsLabel")} value={String(unreadNotifications)} icon={Bell} />
    </div>
  );
}
