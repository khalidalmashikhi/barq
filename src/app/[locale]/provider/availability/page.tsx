import { notFound } from "next/navigation";
import { CalendarClock, Plus, CalendarPlus, Pencil } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { getAvailabilityStateLabel, getAvailabilityStateStyle } from "@/lib/tracking/presentation/availability-state";
import { deleteAvailabilitySlot } from "@/lib/provider/delete-availability-slot";
import { isAvailabilityActionErrorCode, getAvailabilityErrorTranslationKey } from "@/lib/provider/availability-action-errors";
import { ProviderAvailabilityFilters } from "@/components/tracking/provider-availability-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import type { AvailabilitySlotState } from "@prisma/client";
import type { Locale } from "next-intl";
import type { ProviderAvailabilityListItem } from "@/lib/provider/queries/get-provider-availability";

// Phase F.3 (Availability Management: "Calendar-like layout if
// existing data supports it") — no calendar-grid component exists
// anywhere in this codebase, and building one from scratch is out of
// this phase's presentation-only scope; grouping the already-fetched,
// already-date-ordered items by their real calendar day is the
// honest middle ground the goal's own "otherwise improve list
// presentation" clause allows for. Pure client-side grouping of data
// already fetched — no new query, no new sort.
function groupByDate(items: ProviderAvailabilityListItem[], locale: Locale): Array<[string, ProviderAvailabilityListItem[]]> {
  const groups = new Map<string, ProviderAvailabilityListItem[]>();
  for (const item of items) {
    const key = formatDate(new Date(item.startTime), locale, { weekday: "long", day: "numeric", month: "long" });
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return Array.from(groups.entries());
}

// Provider Availability — Provider Dashboard Phase 1d (Availability
// Overview), extended in Phase 4.2 (Provider Experience) with real
// Create/Edit/Delete/Bulk-create actions. Auth is handled entirely by
// src/app/provider/layout.tsx and, independently, by
// getProviderAvailability()'s own requireProvider() call — this page
// performs no auth logic of its own.
//
// DELETE, GATED: only rendered/allowed when bookedCount is 0 — see
// delete-availability-slot.ts's own note. A slot with active bookings
// shows no Delete button at all (not a disabled one), consistent with
// this codebase's "no fake controls" discipline.
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
  error?: string;
};

export default async function ProviderAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  const locale = await getLocale();

  const state = VALID_STATES.includes(params.state as AvailabilitySlotState)
    ? (params.state as AvailabilitySlotState)
    : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // Phase C.3 Group 2 — CRITICAL FIX: getProviderAvailability() calls
  // requireProvider() internally, which throws UnauthenticatedError/
  // ForbiddenError rather than returning an empty result — previously
  // uncaught here. Same catch-and-handle pattern as
  // src/app/[locale]/provider/layout.tsx.
  let result;
  try {
    result = await getProviderAvailability({ q: params.q, state, page });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const hasActiveFilter = Boolean(params.q || params.state);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const availabilityBasePath = getPathname({ href: "/provider/availability", locale });
  const errorMessage =
    params.error && isAvailabilityActionErrorCode(params.error) ? t(getAvailabilityErrorTranslationKey(params.error)) : null;

  // Preserves the page's own filters across a Delete redirect, so
  // acting on a slot never silently discards whatever the provider was
  // searching for — same pattern as provider/bookings/page.tsx's
  // currentQ/currentStatus/currentPage capture (see that file's own
  // note on why these are plain captured strings, not a shared helper
  // function reference).
  const currentQ = params.q;
  const currentState = params.state;
  const currentPage = params.page;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{t("availabilityTitle")}</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/provider/availability/bulk"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <CalendarPlus size={16} strokeWidth={1.75} />
            {t("bulkCreateButton")}
          </Link>
          <Link
            href="/provider/availability/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={16} strokeWidth={2} />
            {t("createSlotButton")}
          </Link>
        </div>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <ProviderAvailabilityFilters currentSearch={params.q} currentState={params.state} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarClock} message={t("noAvailabilityLabel")} description={t("noAvailabilityDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarClock} message={t("availabilityNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarClock} message={t("noAvailabilityMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-6">
          {groupByDate(result.items, locale).map(([dateLabel, slots]) => (
            <div key={dateLabel}>
              <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/40">{dateLabel}</h2>
              <div className="flex flex-col gap-3">
                {slots.map((item) => {
                  const occupancyPercent = item.capacity > 0 ? Math.min(100, Math.round((item.bookedCount / item.capacity) * 100)) : 0;
                  return (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{item.serviceName}</p>
                        <p className="mt-0.5 text-xs text-foreground/40">
                          {formatDate(new Date(item.startTime), locale, { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex flex-wrap shrink-0 items-center gap-2 sm:gap-4">
                        <div className="flex w-28 flex-col gap-1">
                          <span className="text-xs text-foreground/50">
                            {t("capacityLabel", { booked: item.bookedCount, capacity: item.capacity })}
                          </span>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent/15">
                            <div
                              className={occupancyPercent >= 100 ? "h-full bg-danger" : "h-full bg-primary"}
                              style={{ width: `${occupancyPercent}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-medium text-foreground/60">
                          {item.remainingSeats} {tBooking("remainingSeatsLabel")}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${getAvailabilityStateStyle(item.state)}`}>
                          {getAvailabilityStateLabel(item.state)}
                        </span>
                        <Link
                          href={`/provider/availability/${item.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <Pencil size={12} strokeWidth={1.75} />
                          {t("editSlotButton")}
                        </Link>
                        {item.bookedCount === 0 && (
                          <form
                            action={async () => {
                              "use server";
                              const result = await deleteAvailabilitySlot(item.id);
                              const qs = new URLSearchParams();
                              if (currentQ) qs.set("q", currentQ);
                              if (currentState) qs.set("state", currentState);
                              if (currentPage) qs.set("page", currentPage);
                              if (!result.ok) qs.set("error", result.error);
                              const query = qs.toString();
                              redirect({ href: query ? `/provider/availability?${query}` : "/provider/availability", locale });
                            }}
                          >
                            <SubmitButton className="rounded-full border border-danger/30 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50">
                              {t("deleteSlotButton")}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={availabilityBasePath} />
    </div>
  );
}
