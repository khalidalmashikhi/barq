import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { clsx } from "@/components/ui/clsx";
import { Link } from "@/i18n/navigation";
import type { DashboardRecentBookingItem } from "@/lib/dashboard/get-dashboard-data";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Recent Bookings — Customer Experience Platform.
//
// HONEST NAMING, DELIBERATE: labeled "Recent Bookings," never "Recent
// Activity" — this is a list of real Booking rows ordered by
// createdAt, not a multi-event activity/audit log. The dashboard's
// pre-existing ActivityFeed component (a genuinely different, honestly-
// empty placeholder for a future multi-event activity source) is left
// untouched by this phase — the two coexist because they represent
// different concepts, not because of naming drift.
//
// ANY STATUS, MOST RECENT: distinct from RecentBookingsTimeline (this
// same directory), which only shows CONFIRMED bookings ordered by
// confirmedAt ("My Upcoming Bookings"). This list shows the last 5
// bookings regardless of status, ordered by createdAt — a different,
// non-duplicate view of the same underlying table.

type RecentBookingsListProps = {
  bookings: DashboardRecentBookingItem[];
};

export async function RecentBookingsList({ bookings }: RecentBookingsListProps) {
  const t = await getServerTranslator("dashboard");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  return (
    <Card hoverLift={false}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <History size={18} strokeWidth={1.75} aria-hidden />
        {t("recentBookingsTitle")}
      </h2>

      {bookings.length === 0 ? (
        <EmptyState icon={History} message={t("noRecentBookingsLabel")} className="mt-6 border-none" padding="py-8" />
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={`/bookings/${booking.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-accent/10"
              >
                <div>
                  <p className="font-medium text-foreground">{booking.serviceName}</p>
                  <p className="mt-0.5 text-xs text-foreground/40">
                    {formatDate(new Date(booking.createdAt), locale, { day: "numeric", month: "long", year: "numeric" })}
                    {booking.priceSnapshot ? ` · ${booking.priceSnapshot}` : ""}
                  </p>
                </div>
                <span
                  className={clsx("shrink-0 rounded-full px-3 py-1 text-xs font-medium", getBookingStatusStyle(booking.status))}
                >
                  {getBookingStatusLabel(booking.status, tBooking)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
