import { Card } from "@/components/ui/card";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { ProviderBookingStatusCount } from "@/lib/provider/queries/get-provider-metrics";
import type { BookingStatus } from "@prisma/client";

// Bookings by Status — Provider Analytics & Business Insights.
//
// Reuses getBookingStatusLabel()/getBookingStatusStyle() directly (the
// same single source of truth every other booking-status badge in this
// app already uses) — no new status vocabulary, no new colors.
//
// FIXED LIFECYCLE ORDER, NOT THE GROUPBY'S ARBITRARY ORDER: Prisma's
// groupBy result order isn't guaranteed to match the enum's own
// declaration order, so this re-sorts by a fixed display order
// mirroring BookingStatus's schema.prisma declaration sequence
// (CREATED -> ... -> EXPIRED) rather than however the database
// happened to return rows. A status with zero real bookings is never
// shown (bookingsByStatus only ever contains statuses with at least
// one real booking — see get-provider-metrics.ts's own note).

const STATUS_DISPLAY_ORDER: BookingStatus[] = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
  "EXPIRED",
];

type BookingStatusBreakdownProps = {
  items: ProviderBookingStatusCount[];
};

export async function BookingStatusBreakdown({ items }: BookingStatusBreakdownProps) {
  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");

  const countByStatus = new Map(items.map((item) => [item.status, item.count]));
  const orderedItems = STATUS_DISPLAY_ORDER.filter((status) => countByStatus.has(status)).map((status) => ({
    status,
    count: countByStatus.get(status)!,
  }));

  return (
    <Card hoverLift={false}>
      <h2 className="text-lg font-semibold text-foreground">{t("bookingsByStatusTitle")}</h2>

      <div className="mt-5 flex flex-wrap gap-2">
        {orderedItems.map((item) => (
          <span
            key={item.status}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${getBookingStatusStyle(item.status)}`}
          >
            {getBookingStatusLabel(item.status, tBooking)}
            <span className="font-semibold">{item.count}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}
