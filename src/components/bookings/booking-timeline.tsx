import type { LucideIcon } from "lucide-react";
import { CalendarPlus, Clock, CheckCircle2, Loader, XCircle, Ban, AlertTriangle, Circle } from "lucide-react";
import type { BookingActorType, BookingStatus } from "@prisma/client";
import type { BookingTimelineEntry } from "@/lib/booking/lifecycle/get-booking-timeline";
import { getBookingStatusLabel } from "@/lib/booking/booking-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { clsx } from "@/components/ui/clsx";

// Booking Timeline — Phase F.2. Renders the REAL, already-existing
// BookingStatusEvent history (Phase E.1's getBookingTimeline() query,
// previously only consumed by the history API route and its own tests
// — never surfaced in any UI) as a premium vertical timeline. No new
// data, no schema change, no business logic touched: this is the first
// time this real data is shown to a customer.

const STATUS_ICONS: Record<BookingStatus, LucideIcon> = {
  CREATED: CalendarPlus,
  PENDING_PROVIDER: Clock,
  CONFIRMED: CheckCircle2,
  IN_PROGRESS: Loader,
  COMPLETED: CheckCircle2,
  CANCELLED: XCircle,
  REJECTED: Ban,
  DISPUTED: AlertTriangle,
  // System-driven timeout (Phase 5.1) — same "clock ran out" idea as
  // Ban/XCircle for the other negative terminal outcomes.
  EXPIRED: Ban,
};

const STATUS_ICON_STYLES: Record<BookingStatus, string> = {
  CREATED: "bg-accent/20 text-accent-foreground",
  PENDING_PROVIDER: "bg-accent/20 text-accent-foreground",
  CONFIRMED: "bg-success/10 text-success",
  IN_PROGRESS: "bg-secondary/15 text-secondary",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-danger/10 text-danger",
  REJECTED: "bg-danger/10 text-danger",
  DISPUTED: "bg-danger/10 text-danger",
  EXPIRED: "bg-danger/10 text-danger",
};

type BookingTimelineProps = {
  events: BookingTimelineEntry[];
};

export async function BookingTimeline({ events }: BookingTimelineProps) {
  const t = await getServerTranslator("booking");
  const locale = await getLocale();

  if (events.length === 0) return null;

  const actorLabels: Record<BookingActorType, string> = {
    CUSTOMER: t("timelineActorCustomer"),
    PROVIDER: t("timelineActorProvider"),
    SYSTEM: t("timelineActorSystem"),
    ADMIN: t("timelineActorAdmin"),
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-5 text-sm font-medium text-foreground/70">{t("timelineTitle")}</h2>
      <ol className="relative flex flex-col gap-6 border-s border-border ps-6">
        {events.map((event, index) => {
          const Icon = STATUS_ICONS[event.toStatus] ?? Circle;
          const isLast = index === events.length - 1;
          return (
            <li key={event.id} className="relative">
              <span
                className={clsx(
                  "absolute -start-[calc(1.5rem+9px)] flex h-[18px] w-[18px] items-center justify-center rounded-full ring-4 ring-card",
                  STATUS_ICON_STYLES[event.toStatus]
                )}
              >
                <Icon size={11} strokeWidth={2} />
              </span>
              <div className={clsx("flex flex-col gap-0.5", isLast && "font-medium")}>
                <span className="text-sm text-foreground">{getBookingStatusLabel(event.toStatus, t)}</span>
                <span className="text-xs text-foreground/40">
                  {formatDate(event.occurredAt, locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" — "}
                  {actorLabels[event.actorType]}
                </span>
                {event.reason && <span className="text-xs text-foreground/50">{event.reason}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
