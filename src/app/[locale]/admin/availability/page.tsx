import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getAvailabilitySlots } from "@/lib/admin/get-availability-slots";
import { activateAvailability, deactivateAvailability } from "@/lib/admin/transition-availability-state";
import { getAvailabilityStateBadgeVariant, getAvailabilityStateTranslationKey } from "@/lib/admin/presentation/availability-state";
import { isAvailabilityAdminActionErrorCode, getAvailabilityAdminErrorTranslationKey } from "@/lib/admin/availability-admin-errors";
import { AvailabilityFilters } from "@/components/admin/availability-filters";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import type { AvailabilitySlotState } from "@prisma/client";

// Admin Availability — Phase 2.8 (Availability Admin UI), consuming the
// Phase 2.7 (Availability Foundation) admin actions/queries. Mirrors
// admin/prices/page.tsx's list-page shape exactly (flat row-list, no
// date-grouping or occupancy progress bars — those belong to the
// self-service Provider Dashboard's own presentation-phase scope, not
// this admin-management view). Activate/Deactivate are one-click list-
// row actions, same as Price's Deactivate; Edit links to a dedicated
// form, same as every other Admin UI's edit pattern.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const AVAILABILITY_STATES: AvailabilitySlotState[] = ["OPEN", "BLOCKED", "CANCELLED"];

// Admin Operations Platform: `serviceId` is additive — getAvailabilitySlots()
// already accepted this filter; this page now reads it from the URL so
// the Service detail page's new "Availability" cross-link
// (/admin/availability?serviceId=...) actually filters the list.
type SearchParams = { q?: string; state?: string; serviceId?: string; page?: string; error?: string };

export default async function AdminAvailabilityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const state = AVAILABILITY_STATES.includes(params.state as AvailabilitySlotState) ? (params.state as AvailabilitySlotState) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getAvailabilitySlots() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site
  // in this codebase, even though admin/layout.tsx already gates this
  // route: defense in depth, not redundancy.
  let result;
  try {
    result = await getAvailabilitySlots({ q: params.q, state, serviceId: params.serviceId, page });
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

  const hasActiveFilter = Boolean(params.q || params.state || params.serviceId);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const availabilityBasePath = getPathname({ href: "/admin/availability", locale });
  const errorMessage = params.error && isAvailabilityAdminActionErrorCode(params.error) ? t(getAvailabilityAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("availabilityAdminTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("availabilityAdminDescription")}</p>
        </div>
        <Link
          href="/admin/availability/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createAvailabilityButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <AvailabilityFilters currentSearch={params.q} currentState={params.state} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={CalendarClock} message={t("noAvailabilityManagedLabel")} description={t("noAvailabilityManagedDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={CalendarClock} message={t("availabilityNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={CalendarClock} message={t("noAvailabilityMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((slot) => (
            <div key={slot.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/availability/${slot.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {formatDate(new Date(slot.startTime), locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" – "}
                  {formatDate(new Date(slot.endTime), locale, { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">
                  {slot.serviceName} · {slot.bookedCount}/{slot.capacity} booked
                </p>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getAvailabilityStateBadgeVariant(slot.state)}>{t(getAvailabilityStateTranslationKey(slot.state))}</Badge>

                <Link
                  href={`/admin/availability/${slot.id}/edit`}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20"
                >
                  {t("editAvailabilityButton")}
                </Link>

                {slot.state === "OPEN" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await deactivateAvailability(slot.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/availability?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/availability", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                      {t("deactivateAvailabilityButton")}
                    </SubmitButton>
                  </form>
                )}

                {slot.state === "BLOCKED" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await activateAvailability(slot.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/availability?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/availability", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                      {t("activateAvailabilityButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={availabilityBasePath} />
    </div>
  );
}
