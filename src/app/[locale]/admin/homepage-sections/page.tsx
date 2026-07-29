import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { LayoutTemplate, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getHomepageSections } from "@/lib/homepage/get-homepage-sections";
import { showHomepageSection, hideHomepageSection } from "@/lib/homepage/toggle-homepage-section";
import { moveHomepageSectionUp, moveHomepageSectionDown } from "@/lib/homepage/reorder-homepage-section";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Homepage Sections admin — list page. Phase 1.4 (Core Business
// Platform). Mirrors admin/feature-flags/page.tsx's row-list/empty-state/
// Pagination/plain-GET-form-search shape, plus the Move Up/Down actions
// from admin/categories/page.tsx since Ordering is in this phase's scope.
//
// CORRECTED (Growth Foundations phase, 2026-07-27): the comment
// previously here claimed "no rendering code reads this table yet" —
// stale since Phase 1.5 (Homepage Rendering) shipped. The real public
// homepage (src/app/[locale]/page.tsx) now calls
// getHomepageSectionRenderOrder() and renders from it, gated by the
// homepage_dynamic_sections feature flag — so `visible`/`sortOrder`
// changes made here DO affect the live homepage once that flag is on.
// Only each section's own *content* remains hardcoded per-component
// (3 of 13 registry keys — Featured Experiences/Providers/Stats —
// query real data; the rest are still static JSX), which this admin
// page never controlled and still doesn't.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = { q?: string; page?: string; error?: string };

export default async function AdminHomepageSectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getHomepageSections() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site in
  // this codebase, even though admin/layout.tsx already gates this route.
  let result;
  try {
    result = await getHomepageSections({ q: params.q, page });
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
  const sectionsBasePath = getPathname({ href: "/admin/homepage-sections", locale });
  const errorMessage = params.error ? t("homepageSectionErrorUnknown") : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("homepageSectionsTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("homepageSectionsDescription")}</p>
        </div>
        <Link
          href="/admin/homepage-sections/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createHomepageSectionButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <form method="get" className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <input
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder={t("homepageSectionsSearchPlaceholder")}
          aria-label={t("homepageSectionsSearchPlaceholder")}
          className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
          {t("homepageSectionsSearchButton")}
        </button>
      </form>

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={LayoutTemplate} message={t("noHomepageSectionsLabel")} description={t("noHomepageSectionsDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={LayoutTemplate} message={t("homepageSectionsNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={LayoutTemplate} message={t("noHomepageSectionsMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((section) => (
            <div key={section.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/homepage-sections/${section.id}/edit`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{section.label}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-foreground/40">{section.key}</p>
              </Link>

              <div className="flex items-center gap-2">
                <Badge variant={section.visible ? "success" : "default"}>
                  {section.visible ? t("homepageSectionVisibleLabel") : t("homepageSectionHiddenLabel")}
                </Badge>

                <form
                  action={async () => {
                    "use server";
                    await moveHomepageSectionUp(section.id);
                    redirect({ href: "/admin/homepage-sections", locale });
                  }}
                >
                  <SubmitButton
                    aria-label={t("moveUpLabel")}
                    className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50"
                  >
                    <ArrowUp size={16} strokeWidth={1.75} />
                  </SubmitButton>
                </form>
                <form
                  action={async () => {
                    "use server";
                    await moveHomepageSectionDown(section.id);
                    redirect({ href: "/admin/homepage-sections", locale });
                  }}
                >
                  <SubmitButton
                    aria-label={t("moveDownLabel")}
                    className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50"
                  >
                    <ArrowDown size={16} strokeWidth={1.75} />
                  </SubmitButton>
                </form>

                <form
                  action={async () => {
                    "use server";
                    const result = section.visible
                      ? await hideHomepageSection(section.id)
                      : await showHomepageSection(section.id);
                    if (!result.ok) {
                      redirect({ href: `/admin/homepage-sections?error=${result.error}`, locale });
                      return;
                    }
                    redirect({ href: "/admin/homepage-sections", locale });
                  }}
                >
                  <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                    {section.visible ? t("hideHomepageSectionButton") : t("showHomepageSectionButton")}
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={sectionsBasePath} />
    </div>
  );
}
