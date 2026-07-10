import { CalendarX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { clsx } from "@/components/ui/clsx";
import type { DashboardBookingSummary } from "@/lib/dashboard/get-dashboard-data";

// Upcoming bookings timeline — Engineering Sprint (Dashboard Data
// Wiring). Now takes real Booking data as a prop instead of hardcoded
// content. Empty state shown when the array is empty (no bookings yet,
// or no Customer profile) — real data only, per explicit instruction.

const statusLabels: Record<string, string> = {
  CONFIRMED: "مؤكد",
  IN_PROGRESS: "جارٍ",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
  DISPUTED: "قيد المراجعة",
  CREATED: "قيد الانتظار",
};

const statusStyles: Record<string, string> = {
  CONFIRMED: "bg-success/10 text-success",
  IN_PROGRESS: "bg-secondary/15 text-secondary",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-danger/10 text-danger",
  DISPUTED: "bg-danger/10 text-danger",
  CREATED: "bg-accent/20 text-accent-foreground",
};

type RecentBookingsTimelineProps = {
  bookings: DashboardBookingSummary[];
};

export function RecentBookingsTimeline({ bookings }: RecentBookingsTimelineProps) {
  return (
    <Card hoverLift={false}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span aria-hidden>📅</span>
        حجوزاتي القادمة
      </h2>

      {bookings.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center">
          <CalendarX size={28} strokeWidth={1.5} className="text-foreground/25" />
          <p className="text-sm text-foreground/50">لا توجد حجوزات قادمة حالياً</p>
        </div>
      ) : (
        <ol className="relative mt-6 flex flex-col gap-6 border-s border-border ps-6">
          {bookings.map((booking) => (
            <li key={booking.id} className="relative">
              <span className="absolute -start-[1.65rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{booking.serviceName}</p>
                  <p className="mt-0.5 text-xs text-foreground/40">
                    {booking.confirmedAt
                      ? new Date(booking.confirmedAt).toLocaleDateString("ar-OM", { day: "numeric", month: "long" })
                      : "—"}
                  </p>
                </div>
                <span
                  className={clsx(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                    statusStyles[booking.status] ?? "bg-accent/20 text-accent-foreground"
                  )}
                >
                  {statusLabels[booking.status] ?? booking.status}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
