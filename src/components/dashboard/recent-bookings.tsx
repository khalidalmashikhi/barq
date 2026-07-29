import { CalendarX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { clsx } from "@/components/ui/clsx";
import { Link } from "@/i18n/navigation";
import type { DashboardBookingSummary } from "@/lib/dashboard/get-dashboard-data";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

// Upcoming bookings timeline — Engineering Sprint (Dashboard Data
// Wiring). Now takes real Booking data as a prop instead of hardcoded
// content. Empty state shown when the array is empty (no bookings yet,
// or no Customer profile) — real data only, per explicit instruction.

type RecentBookingsTimelineProps = {
  bookings: DashboardBookingSummary[];
};

export async function RecentBookingsTimeline({ bookings }: RecentBookingsTimelineProps) {
  const t = await getServerTranslator("dashboard");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  return (
    <Card hoverLift={false}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>📅</span>
        {t("upcomingBookingsTitle")}
      </h2>

      {bookings.length === 0 ? (
        <EmptyState icon={CalendarX} message={t("noUpcomingBookingsLabel")} className="mt-6 border-none" padding="py-8" />
      ) : (
        <ol className="relative mt-6 flex flex-col gap-6 border-s border-border ps-6">
          {bookings.map((booking) => (
            <li key={booking.id} className="relative">
              <span className="absolute -start-[1.65rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
              <Link
                href={`/bookings/${booking.id}`}
                className="flex items-center justify-between gap-4 rounded-xl transition-opacity hover:opacity-70"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{booking.serviceName}</p>
                  <p className="mt-0.5 text-xs text-foreground/40">
                    {booking.confirmedAt
                      ? formatDate(new Date(booking.confirmedAt), locale, { day: "numeric", month: "long" })
                      : "—"}
                  </p>
                </div>
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                    getBookingStatusStyle(booking.status)
                  )}
                >
                  {getBookingStatusLabel(booking.status, tBooking)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
