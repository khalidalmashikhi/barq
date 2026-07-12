import { CalendarClock } from "lucide-react";
import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { getAvailabilityStateLabel, getAvailabilityStateStyle } from "@/lib/tracking/presentation/availability-state";
import { ProviderAvailabilityFilters } from "@/components/tracking/provider-availability-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n/strings";
import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";
import type { AvailabilitySlotState } from "@prisma/client";

// Provider Availability — Provider Dashboard Phase 1d (Availability
// Overview, read-only foundation). No create/edit/open-close/capacity
// actions exist here — this phase is strictly a read-only overview.
// Auth is handled entirely by src/app/provider/layout.tsx and,
// independently, by getProviderAvailability()'s own requireProvider()
// call — this page performs no auth logic of its own.
//
// UPCOMING ONLY, PERMANENTLY THIS PHASE: no past/history/all toggle
// exists — the query itself has no such parameter, per explicit
// instruction.
//
// ROWS, NOT A DETAIL LINK YET: each row is a single wrapping <div>,
// keyed by and built around the real availability id — not yet a
// <Link> (no /provider/availability/[id] exists this phase), but
// structured so that page can be added later without restructuring
// this list, mirroring the identical decision already made for
// Services and Bookings.
//
// Date/time is shown plainly (no relative "Today"/"Tomorrow" label) —
// deliberately avoiding the exact class of server-local-time bug
// already found (and left untouched, per explicit instruction) in
// services/[id]/page.tsx's own "Upcoming Slots" section.

const VALID_STATES: AvailabilitySlotState[] = ["OPEN", "BLOCKED", "CANCELLED"];

type SearchParams = {
  q?: string;
  state?: string;
  page?: string;
};

export default async function ProviderAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const state = VALID_STATES.includes(params.state as AvailabilitySlotState)
    ? (params.state as AvailabilitySlotState)
    : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const result = await getProviderAvailability({ q: params.q, state, page });

  const hasActiveFilter = Boolean(params.q || params.state);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <h1 className="text-2xl font-semibold text-foreground">{t.providerAvailabilityTitle}</h1>

      <ProviderAvailabilityFilters currentSearch={params.q} currentState={params.state} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarClock} message={t.providerNoAvailabilityLabel} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarClock} message={t.providerAvailabilityNoResultsOnPageLabel} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarClock} message={t.providerNoAvailabilityMatchLabel} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <div>
                <p className="font-medium text-foreground">{item.serviceName}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {new Date(item.startTime).toLocaleString("ar-OM", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: OMAN_TIME_ZONE,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground/50">
                  {item.remainingSeats} {t.remainingSeatsLabel}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getAvailabilityStateStyle(item.state)}`}>
                  {getAvailabilityStateLabel(item.state)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath="/provider/availability" />
    </div>
  );
}
