import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ToggleLeft, Plus } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getFeatureFlags } from "@/lib/feature-flags/get-feature-flags";
import { enableFeatureFlag, disableFeatureFlag } from "@/lib/feature-flags/toggle-feature-flag";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Feature Flags admin — list page. Phase 1.3 (Core Business Platform).
// Mirrors admin/categories/page.tsx's list-page shape (row-list, 3-tier
// empty state, Pagination, plain GET-form search) — deliberately simpler
// than Category's own list, since this phase's scope is explicitly
// "global on/off only": no visibility filter dropdown is needed (there
// are only 2 states, shown as a single quick-toggle action per row, not a
// separate filter control), no nested child-entity list.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = { q?: string; page?: string; error?: string };

export default async function AdminFeatureFlagsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getFeatureFlags() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site in
  // this codebase, even though admin/layout.tsx already gates this route.
  let result;
  try {
    result = await getFeatureFlags({ q: params.q, page });
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

  const hasActiveFilter = Boolean(params.q);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const flagsBasePath = getPathname({ href: "/admin/feature-flags", locale });
  const errorMessage = params.error ? t("featureFlagErrorUnknown") : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("featureFlagsTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("featureFlagsDescription")}</p>
        </div>
        <Link
          href="/admin/feature-flags/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createFeatureFlagButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <form method="get" className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={t("featureFlagsSearchPlaceholder")}
          aria-label={t("featureFlagsSearchPlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("featureFlagsSearchButton")}
        </button>
      </form>

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={ToggleLeft} message={t("noFeatureFlagsLabel")} description={t("noFeatureFlagsDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={ToggleLeft} message={t("featureFlagsNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={ToggleLeft} message={t("noFeatureFlagsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((flag) => (
            <div key={flag.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/feature-flags/${flag.id}/edit`} className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-medium text-foreground">{flag.key}</p>
                {flag.description && <p className="mt-0.5 truncate text-xs text-foreground/40">{flag.description}</p>}
              </Link>

              <div className="flex items-center gap-2">
                <Badge variant={flag.enabled ? "success" : "default"}>
                  {flag.enabled ? t("featureFlagEnabledLabel") : t("featureFlagDisabledLabel")}
                </Badge>

                <form
                  action={async () => {
                    "use server";
                    const result = flag.enabled ? await disableFeatureFlag(flag.id) : await enableFeatureFlag(flag.id);
                    if (!result.ok) {
                      redirect({ href: `/admin/feature-flags?error=${result.error}`, locale });
                      return;
                    }
                    redirect({ href: "/admin/feature-flags", locale });
                  }}
                >
                  <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                    {flag.enabled ? t("disableFeatureFlagButton") : t("enableFeatureFlagButton")}
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={flagsBasePath} />
    </div>
  );
}
