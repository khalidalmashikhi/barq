import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight, CalendarClock, Briefcase, Pencil } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { getProviderBookings } from "@/lib/provider/queries/get-provider-bookings";
import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { getServiceStatusBadgeVariant, getServiceStatusTranslationKey } from "@/lib/services/presentation/service-status";
import { canPublishService, canUnpublishService, canArchiveService } from "@/lib/services/service-status-policy";
import { publishService, unpublishService, archiveService } from "@/lib/provider/transition-service-status";
import { duplicateService } from "@/lib/provider/duplicate-service";
import { isServiceActionErrorCode, getServiceErrorTranslationKey } from "@/lib/provider/service-action-errors";
import { getAvailabilityStateLabel, getAvailabilityStateStyle } from "@/lib/tracking/presentation/availability-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { ProviderRecentActivity } from "@/components/provider/recent-activity";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";

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
// ACTIONS, ADDED PHASE 4.2 (Provider Experience): Edit, Publish,
// Unpublish, Archive, and Duplicate all live here, per this file's own
// original design note that this page (not the list page) would be
// their future home. Publish/Unpublish/Archive are inline server-
// action forms mirroring provider/bookings's Accept/Reject pattern
// exactly, gated by service-status-policy.ts's transition matrix — only
// the buttons valid for the service's CURRENT status are rendered, so
// there is no disabled-button state to design for. Price editing
// remains out of scope (Price is append-only/versioned in this schema;
// see update-service.ts's own note) — still no price-change control
// here.
//
// DATE FORMATTING (Phase A.5 Group 7): every date/time below goes
// through the shared formatDate() helper, which always sets timeZone
// to the OMAN_TIME_ZONE constant internally (not the server's
// runtime-local timezone) and resolves the BCP-47 tag from the current
// request locale via getLocale(), rather than a hardcoded "ar-OM"
// literal. The pre-existing customer-facing isToday bug remains
// untouched — related, acknowledged, out-of-scope technical debt.

const PREVIEW_PAGE_SIZE = 5;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function ProviderServiceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const locale = await getLocale();

  // Phase C.3 Group 2 — CRITICAL FIX: getProviderServiceDetail() calls
  // requireProvider() internally (its own independent re-check, per
  // this file's own established defense-in-depth design), which throws
  // UnauthenticatedError/ForbiddenError rather than returning null —
  // previously uncaught here, surfacing as an unhandled server-log
  // error even though the layout's own check still correctly resolved
  // the user-facing result. Same catch-and-handle pattern as
  // src/app/[locale]/provider/layout.tsx.
  let service;
  try {
    service = await getProviderServiceDetail(id);
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

  if (!service) {
    notFound();
  }

  const [bookingsPreview, availabilityPreview] = await Promise.all([
    getProviderBookings({ serviceId: id, page: 1, pageSize: PREVIEW_PAGE_SIZE }),
    getProviderAvailability({ serviceId: id, page: 1, pageSize: PREVIEW_PAGE_SIZE }),
  ]);

  const t = await getServerTranslator("provider");
  const tBooking = await getServerTranslator("booking");
  // Reuses the existing, already-fully-translated serviceStatus* keys
  // (see src/lib/services/presentation/service-status.ts's own note).
  const tStatus = await getServerTranslator("admin");
  const errorMessage = error && isServiceActionErrorCode(error) ? t(getServiceErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <Link
        href="/provider/services"
        className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToServicesLabel")}
      </Link>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{service.name}</h1>
            {service.description && (
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">{service.description}</p>
            )}
          </div>
          <Badge variant={getServiceStatusBadgeVariant(service.status)} className="shrink-0">
            {tStatus(getServiceStatusTranslationKey(service.status))}
          </Badge>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4 text-sm sm:flex-row sm:gap-8">
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t("servicePriceLabel")}</span>
            <span className="font-medium text-primary">{service.price ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t("serviceCreatedLabel")}</span>
            <span className="font-medium text-foreground">
              {formatDate(service.createdAt, locale, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1">
            <span className="text-foreground/50">{t("serviceUpdatedLabel")}</span>
            <span className="font-medium text-foreground">
              {formatDate(service.updatedAt, locale, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/provider/services/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <Pencil size={14} strokeWidth={1.75} />
          {t("editExperienceButton")}
        </Link>

        {canPublishService(service.status) && (
          <form
            action={async () => {
              "use server";
              const result = await publishService(id);
              redirect({ href: `/provider/services/${id}${result.ok ? "" : `?error=${result.error}`}`, locale });
            }}
          >
            <SubmitButton className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("publishButton")}
            </SubmitButton>
          </form>
        )}

        {canUnpublishService(service.status) && (
          <form
            action={async () => {
              "use server";
              const result = await unpublishService(id);
              redirect({ href: `/provider/services/${id}${result.ok ? "" : `?error=${result.error}`}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50">
              {t("unpublishButton")}
            </SubmitButton>
          </form>
        )}

        <form
          action={async () => {
            "use server";
            const result = await duplicateService(id);
            if (!result.ok) {
              redirect({ href: `/provider/services/${id}?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/provider/services/${result.serviceId}`, locale });
          }}
        >
          <SubmitButton className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50">
            {t("duplicateButton")}
          </SubmitButton>
        </form>

        {canArchiveService(service.status) && (
          <form
            action={async () => {
              "use server";
              const result = await archiveService(id);
              redirect({ href: `/provider/services/${id}${result.ok ? "" : `?error=${result.error}`}`, locale });
            }}
          >
            <SubmitButton className="rounded-full border border-danger/30 bg-danger/5 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:opacity-50">
              {t("archiveButton")}
            </SubmitButton>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("serviceBookingsCountLabel")} value={String(bookingsPreview.totalCount)} icon={Briefcase} />
        <StatCard label={tBooking("upcomingSlotsTitle")} value={String(availabilityPreview.totalCount)} icon={CalendarClock} />
      </div>

      <Card hoverLift={false}>
        <h2 className="text-lg font-semibold text-foreground">{tBooking("upcomingSlotsTitle")}</h2>

        {availabilityPreview.items.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={CalendarClock} message={t("noAvailabilityLabel")} padding="py-8" />
          </div>
        ) : (
          <ol className="mt-6 flex flex-col gap-4">
            {availabilityPreview.items.map((slot) => (
              <li
                key={slot.id}
                className="flex items-center justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <span className="text-sm text-foreground">
                  {formatDate(slot.startTime, locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-foreground/50">
                    {slot.remainingSeats} {tBooking("remainingSeatsLabel")}
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
