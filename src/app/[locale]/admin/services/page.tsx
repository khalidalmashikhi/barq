import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Compass, Plus } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getServices } from "@/lib/admin/get-services";
import { publishService, unpublishService, archiveService } from "@/lib/admin/transition-service-status";
import { getServiceStatusBadgeVariant, getServiceStatusTranslationKey } from "@/lib/services/presentation/service-status";
import { isServiceAdminActionErrorCode, getServiceAdminErrorTranslationKey } from "@/lib/admin/service-admin-errors";
import { ServiceFilters } from "@/components/admin/service-filters";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { ServiceStatus } from "@prisma/client";

// Admin Services — Phase 2.4 (Service Admin UI), consuming the Phase
// 2.3 (Service Foundation) admin actions/queries. Mirrors
// admin/providers/page.tsx's list-page shape exactly (row-list, 3-tier
// empty state, Pagination, filters-as-plain-GET-form, one-click
// Publish/Unpublish/Archive) — the closest existing precedent, since
// Service Foundation itself mirrors Provider Foundation's admin/
// self-service split.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const SERVICE_STATUSES: ServiceStatus[] = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"];

// Admin Operations Platform: `providerId` is additive — getServices()
// already accepted this filter (used nowhere in the UI before this
// phase); this page now reads it from the URL so the Provider detail
// page's new "Services" cross-link (/admin/services?providerId=...)
// actually filters the list. Not part of <ServiceFilters>'s own
// search/status form, same as the pre-existing `error` param.
type SearchParams = { q?: string; status?: string; providerId?: string; page?: string; error?: string };

export default async function AdminServicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const status = SERVICE_STATUSES.includes(params.status as ServiceStatus) ? (params.status as ServiceStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getServices() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site
  // in this codebase, even though admin/layout.tsx already gates this
  // route: defense in depth, not redundancy.
  let result;
  try {
    result = await getServices({ q: params.q, status, providerId: params.providerId, page });
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

  const hasActiveFilter = Boolean(params.q || params.status || params.providerId);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const servicesBasePath = getPathname({ href: "/admin/services", locale });
  const errorMessage = params.error && isServiceAdminActionErrorCode(params.error) ? t(getServiceAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("servicesTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("servicesDescription")}</p>
        </div>
        <Link
          href="/admin/services/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createServiceButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <ServiceFilters currentSearch={params.q} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={Compass} message={t("noServicesManagedLabel")} description={t("noServicesManagedDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={Compass} message={t("servicesNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={Compass} message={t("noServicesMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((service) => (
            <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/services/${service.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{service.name}</p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">
                  {service.providerName}
                  {service.activePrice ? ` · ${service.activePrice}` : ""}
                </p>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getServiceStatusBadgeVariant(service.status)}>{t(getServiceStatusTranslationKey(service.status))}</Badge>

                {service.status !== "ARCHIVED" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = service.status === "PUBLISHED" ? await unpublishService(service.id) : await publishService(service.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/services?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/services", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                      {service.status === "PUBLISHED" ? t("unpublishServiceButton") : t("publishServiceButton")}
                    </SubmitButton>
                  </form>
                )}

                {service.status !== "ARCHIVED" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await archiveService(service.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/services?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/services", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                      {t("archiveServiceButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={servicesBasePath} />
    </div>
  );
}
