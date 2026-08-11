import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { PackageOpen, Plus, AlertTriangle } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderServices } from "@/lib/provider/queries/get-provider-services";
import { getServiceStatusBadgeVariant, getServiceStatusTranslationKey } from "@/lib/services/presentation/service-status";
import { ProviderServiceFilters } from "@/components/provider/service-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format-date";
import { getPathname } from "@/i18n/navigation";
import type { ServiceStatus } from "@prisma/client";

// Provider Services list — Provider Dashboard Phase 1b. Read-only:
// no create/edit/delete/publish actions exist here, per explicit
// scope. Auth is handled entirely by src/app/provider/layout.tsx and,
// independently, by getProviderServices()'s own requireProvider()
// call — this page performs no auth logic of its own.
//
// ROWS, NOT CARDS OR A TABLE: mirrors the existing /bookings row-list
// convention exactly — no shared table component exists anywhere in
// this codebase, and ExperienceCard's marketing styling (Book Now CTA,
// favorite heart) is the wrong shape for a provider reviewing their
// own catalog.
//
// LINKS TO /provider/services/[id] (Phase 2): each row is now a real
// <Link>, cashing in the "carry the id cleanly" design from Phase 1b —
// same hover-shadow affordance already used by the Customer /bookings
// list for its own clickable rows. Layout, fields, styling, filters,
// and pagination are otherwise byte-for-byte unchanged.

const VALID_STATUSES: ServiceStatus[] = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"];

type SearchParams = {
  q?: string;
  status?: string;
  sort?: string;
  page?: string;
};

export default async function ProviderServicesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getServerTranslator("provider");
  // Reuses the existing, already-fully-translated serviceStatus* keys
  // (see src/lib/services/presentation/service-status.ts's own note on
  // why these live in the "admin" namespace without being admin-only).
  const tStatus = await getServerTranslator("admin");
  const locale = await getLocale();

  const status = VALID_STATUSES.includes(params.status as ServiceStatus) ? (params.status as ServiceStatus) : undefined;
  const sort =
    params.sort === "price_asc" || params.sort === "price_desc" ? params.sort : "newest";
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // Phase C.3 Group 2 — CRITICAL FIX: getProviderServices() calls
  // requireProvider() internally, which throws UnauthenticatedError/
  // ForbiddenError rather than returning an empty result — previously
  // uncaught here. Same catch-and-handle pattern as
  // src/app/[locale]/provider/layout.tsx.
  let result;
  try {
    result = await getProviderServices({ q: params.q, status, sort, page });
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

  const hasActiveFilter = Boolean(params.q || params.status);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const servicesBasePath = getPathname({ href: "/provider/services", locale });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{t("servicesTitle")}</h1>
        <Link
          href="/provider/services/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createExperienceButton")}
        </Link>
      </div>

      <ProviderServiceFilters currentSearch={params.q} currentStatus={params.status} currentSort={params.sort} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState
          icon={PackageOpen}
          message={t("noServicesLabel")}
          description={t("noServicesDescription")}
          gap="gap-3"
          padding="py-16"
          action={
            <Link
              href="/provider/services/new"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Plus size={16} strokeWidth={2} />
              {t("createExperienceButton")}
            </Link>
          }
        />
      ) : isOutOfRangePage ? (
        <EmptyState icon={PackageOpen} message={t("servicesNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={PackageOpen} message={t("noServicesMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((item) => (
            <Link
              key={item.id}
              href={`/provider/services/${item.id}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground">{item.name}</p>
                  {item.hasNoUpcomingAvailability && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[0.65rem] font-semibold text-danger">
                      <AlertTriangle size={11} strokeWidth={2} />
                      {t("noUpcomingAvailabilityLabel")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-foreground/40">
                  {formatDate(new Date(item.createdAt), locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {item.price && <span className="text-sm font-semibold text-primary">{item.price}</span>}
                <Badge variant={getServiceStatusBadgeVariant(item.status)}>{tStatus(getServiceStatusTranslationKey(item.status))}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={servicesBasePath} />
    </div>
  );
}
