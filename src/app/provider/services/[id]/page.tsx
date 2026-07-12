import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock, Briefcase } from "lucide-react";
import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { getProviderBookings } from "@/lib/provider/queries/get-provider-bookings";
import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { getServiceStatusLabel, getServiceStatusStyle } from "@/lib/services/presentation/service-status";
import { getAvailabilityStateLabel, getAvailabilityStateStyle } from "@/lib/tracking/presentation/availability-state";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { ProviderRecentActivity } from "@/components/provider/recent-activity";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n/strings";
import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";

// Provider Service Detail — Provider Dashboard Phase 2 (Service Detail
// Workspace, read-only foundation).
//
// NO BUSINESS LOGIC HERE, PER EXPLICIT INSTRUCTION: this component
// only parses/validates the route param, calls 3 already-existing,
// permanently read-only query functions, and renders their results —
// every real rule (ownership, price selection, defensive clamping,
// search/filter reuse) lives inside those query modules, not here.
//
// PREVIEWS, NOT FULL HISTORIES: bookings and availability are both
// fetched with pageSize: 5 via the SAME queries the standalone
// /provider/bookings and /provider/availability pages already use,
// scoped by the new optional `serviceId` filter — no new counting or
// listing logic was written for this page. `totalCount` from each
// result (already computed by those queries) is reused directly for
// the quick-stat numbers, not recomputed separately.
//
// NO ACTIONS OF ANY KIND: no edit/publish/pause/archive/price-change/
// availability/booking buttons exist here, not even disabled or
// hidden placeholders — per explicit instruction. This page IS the
// future home for those actions (unlike the list pages, which all
// deliberately deferred actions to *this* page) — but building fake
// controls ahead of real functionality would repeat the exact "fake
// admin panel" pattern this project has already rejected elsewhere
// (Quick Actions, empty-state CTAs to nonexistent destinations).
//
// OMAN TIMEZONE, EXPLICIT: every date/time below passes the shared
// OMAN_TIME_ZONE constant explicitly — the previous phases' list pages
// relied on the "ar-OM" locale alone, which affects language/numeral
// conventions but not which timezone is actually rendered, meaning
// server-local time (not necessarily Oman time) was what actually
// displayed there. This was fixed here first, then extended to the
// standalone Services/Bookings/Availability list pages and
// ProviderRecentActivity in a follow-up timezone-consistency pass
// (all five now import the same shared constant rather than each
// hardcoding "Asia/Muscat" independently). The pre-existing
// customer-facing isToday bug remains untouched — related,
// acknowledged, out-of-scope technical debt.

const PREVIEW_PAGE_SIZE = 5;

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProviderServiceDetailPage({ params }: Props) {
  const { id } = await params;

  const service = await getProviderServiceDetail(id);
  if (!service) {
    notFound();
  }

  const [bookingsPreview, availabilityPreview] = await Promise.all([
    getProviderBookings({ serviceId: id, page: 1, pageSize: PREVIEW_PAGE_SIZE }),
    getProviderAvailability({ serviceId: id, page: 1, pageSize: PREVIEW_PAGE_SIZE }),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/services"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t.providerBackToServicesLabel}
      </Link>

      <Card hoverLift={false}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{service.name}</h1>
            {service.description && (
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">{service.description}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${getServiceStatusStyle(service.status)}`}
          >
            {getServiceStatusLabel(service.status)}
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 text-sm sm:flex-row sm:gap-8">
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t.providerServicePriceLabel}</span>
            <span className="font-medium text-primary">{service.price ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t.providerServiceCreatedLabel}</span>
            <span className="font-medium text-foreground">
              {service.createdAt.toLocaleDateString("ar-OM", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: OMAN_TIME_ZONE,
              })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t.providerServiceUpdatedLabel}</span>
            <span className="font-medium text-foreground">
              {service.updatedAt.toLocaleDateString("ar-OM", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: OMAN_TIME_ZONE,
              })}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t.providerServiceBookingsCountLabel} value={String(bookingsPreview.totalCount)} icon={Briefcase} />
        <StatCard label={t.upcomingSlotsTitle} value={String(availabilityPreview.totalCount)} icon={CalendarClock} />
      </div>

      <Card hoverLift={false}>
        <h2 className="text-lg font-semibold text-foreground">{t.upcomingSlotsTitle}</h2>

        {availabilityPreview.items.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={CalendarClock} message={t.providerNoAvailabilityLabel} padding="py-8" />
          </div>
        ) : (
          <ol className="mt-6 flex flex-col gap-4">
            {availabilityPreview.items.map((slot) => (
              <li
                key={slot.id}
                className="flex items-center justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <span className="text-sm text-foreground">
                  {slot.startTime.toLocaleString("ar-OM", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: OMAN_TIME_ZONE,
                  })}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-foreground/50">
                    {slot.remainingSeats} {t.remainingSeatsLabel}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${getAvailabilityStateStyle(slot.state)}`}
                  >
                    {getAvailabilityStateLabel(slot.state)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <ProviderRecentActivity items={bookingsPreview.items} />
    </div>
  );
}
