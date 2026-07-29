import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { Users, Plus } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviders } from "@/lib/admin/get-providers";
import { approveProvider } from "@/lib/admin/approve-provider";
import { archiveProvider } from "@/lib/admin/archive-provider";
import { publishProvider, unpublishProvider } from "@/lib/admin/toggle-provider-visibility";
import { getProviderStatusBadgeVariant, getProviderStatusTranslationKey } from "@/lib/admin/presentation/provider-status";
import { isProviderAdminActionErrorCode, getProviderAdminErrorTranslationKey } from "@/lib/admin/provider-admin-errors";
import { ProviderFilters } from "@/components/admin/provider-filters";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { ProviderStatus } from "@prisma/client";

// Admin Providers — extended in Phase 2.2 (Provider Admin UI) from
// Phase 4.1's original approve-only pending-providers view into the
// full Provider list page this phase's own scope requests (Search/
// Filters/Pagination/status+visibility badges/Publish-Unpublish/
// Archive). Reuses getProviders() (Phase 2.1) instead of the narrower
// getPendingProviders() — but the original Approve action for
// APPLIED/UNDER_REVIEW providers is preserved unchanged: this phase's
// own instructions say "consume the existing actions... do not
// redesign the backend," and removing a real, working admin capability
// would be a regression, not a redesign. Mirrors
// admin/categories/page.tsx's list-page shape (row-list, 3-tier empty
// state, Pagination, filters-as-plain-GET-form).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const PROVIDER_STATUSES: ProviderStatus[] = ["APPLIED", "UNDER_REVIEW", "APPROVED", "SUSPENDED", "DEACTIVATED"];

type SearchParams = { q?: string; status?: string; page?: string; error?: string };

export default async function AdminProvidersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const status = PROVIDER_STATUSES.includes(params.status as ProviderStatus) ? (params.status as ProviderStatus) : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getProviders() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site
  // in this codebase, even though admin/layout.tsx already gates this
  // route: defense in depth, not redundancy.
  let result;
  try {
    result = await getProviders({ q: params.q, status, page });
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
  const providersBasePath = getPathname({ href: "/admin/providers", locale });
  const errorMessage = params.error && isProviderAdminActionErrorCode(params.error) ? t(getProviderAdminErrorTranslationKey(params.error)) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("providersTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("providersDescription")}</p>
        </div>
        <Link
          href="/admin/providers/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createProviderButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <ProviderFilters currentSearch={params.q} currentStatus={params.status} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={Users} message={t("noProvidersManagedLabel")} description={t("noProvidersManagedDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={Users} message={t("providersNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={Users} message={t("noProvidersMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((provider) => (
            <div key={provider.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/providers/${provider.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{provider.businessName}</p>
                <p className="mt-0.5 truncate text-xs text-foreground/40">
                  {provider.slug ? `/${provider.slug}` : t("noSlugLabel")}
                  {provider.city ? ` · ${provider.city}` : ""}
                </p>
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getProviderStatusBadgeVariant(provider.status)}>{t(getProviderStatusTranslationKey(provider.status))}</Badge>
                <Badge variant={provider.visible ? "success" : "default"}>
                  {provider.visible ? t("providerVisibleLabel") : t("providerHiddenLabel")}
                </Badge>

                {(provider.status === "APPLIED" || provider.status === "UNDER_REVIEW") && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await approveProvider(provider.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/providers?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/providers", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                      {t("approveButton")}
                    </SubmitButton>
                  </form>
                )}

                <form
                  action={async () => {
                    "use server";
                    const result = provider.visible ? await unpublishProvider(provider.id) : await publishProvider(provider.id);
                    if (!result.ok) {
                      redirect({ href: `/admin/providers?error=${result.error}`, locale });
                      return;
                    }
                    redirect({ href: "/admin/providers", locale });
                  }}
                >
                  <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                    {provider.visible ? t("unpublishProviderButton") : t("publishProviderButton")}
                  </SubmitButton>
                </form>

                {provider.status !== "DEACTIVATED" && (
                  <form
                    action={async () => {
                      "use server";
                      const result = await archiveProvider(provider.id);
                      if (!result.ok) {
                        redirect({ href: `/admin/providers?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/providers", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                      {t("archiveProviderButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={providersBasePath} />
    </div>
  );
}
