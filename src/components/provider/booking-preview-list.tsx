import { CalendarX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getBookingStatusLabel, getBookingStatusStyle } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProviderBookingPreviewItem } from "@/lib/provider/queries/get-provider-overview";

// Booking preview list — Phase F.3 (Provider Dashboard: Today's
// Bookings / Upcoming Bookings sections). Reused for both sections
// with a different title/icon/empty-message, same real data shape
// (ProviderBookingPreviewItem, slot-time ordered — distinct from
// ProviderRecentActivity's createdAt-ordered feed).

type BookingPreviewListProps = {
  title: string;
  icon: LucideIcon;
  items: ProviderBookingPreviewItem[];
  emptyMessage: string;
  viewAllHref: string;
  viewAllLabel: string;
};

export async function BookingPreviewList({ title, icon: Icon, items, emptyMessage, viewAllHref, viewAllLabel }: BookingPreviewListProps) {
  const t = await getServerTranslator("booking");
  const locale = await getLocale();

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Icon size={16} strokeWidth={1.75} />
          {title}
        </h2>
        <Link href={viewAllHref} className="rounded text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          {viewAllLabel}
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={CalendarX} iconSize={22} gap="gap-1.5" padding="py-6" message={emptyMessage} messageClassName="text-sm text-foreground/50" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/provider/bookings/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">{item.serviceName}</span>
                  <span className="text-xs text-foreground/40">
                    {formatDate(item.slotStartTime, locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {item.seats} {t("seatsSuffixLabel")}
                  </span>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getBookingStatusStyle(item.status)}`}>
                  {getBookingStatusLabel(item.status, t)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
