import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { FolderTree, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCategories } from "@/lib/categories/get-categories";
import { archiveCategory } from "@/lib/categories/transition-category-visibility";
import { moveCategoryUp, moveCategoryDown } from "@/lib/categories/reorder-category";
import { getCategoryVisibilityStyle, getCategoryVisibilityTranslationKey } from "@/lib/categories/presentation/category-visibility";
import { CategoryFilters } from "@/components/admin/category-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Category Admin — list page. Phase 1.2 (Category Admin UI). Backend
// only from Phase 1.1 (+ this phase's own reorder-category.ts addition)
// is used here — no mutation/business-rule logic changes. Mirrors
// provider/services/page.tsx's list-page shape exactly: row-list (no
// table component exists anywhere in this codebase), same 3-tier empty
// state, same Pagination component, same filters-as-plain-GET-form
// pattern.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const VISIBILITY_STATUSES: CategoryVisibilityStatus[] = ["PUBLIC", "HIDDEN", "LINK_ONLY", "INVITE_ONLY", "SCHEDULED", "ARCHIVED"];

type SearchParams = { q?: string; visibility?: string; page?: string; error?: string };

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const visibilityStatus = VISIBILITY_STATUSES.includes(params.visibility as CategoryVisibilityStatus)
    ? (params.visibility as CategoryVisibilityStatus)
    : undefined;
  const pageParsed = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  // getCategories() calls requireAdmin() internally — same
  // catch-and-handle pattern as every other role-gated query call site
  // in this codebase, even though admin/layout.tsx already gates this
  // route: defense in depth, not redundancy.
  let result;
  try {
    result = await getCategories({ q: params.q, visibilityStatus, page });
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

  const hasActiveFilter = Boolean(params.q || params.visibility);
  const isOutOfRangePage = result.totalCount > 0 && result.items.length === 0;
  const categoriesBasePath = getPathname({ href: "/admin/categories", locale });
  const errorMessage = params.error ? t("categoryErrorUnknown") : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("categoriesTitle")}</h1>
          <p className="mt-1 text-sm text-foreground/60">{t("categoriesDescription")}</p>
        </div>
        <Link
          href="/admin/categories/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} strokeWidth={2} />
          {t("createCategoryButton")}
        </Link>
      </div>

      {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

      <CategoryFilters currentSearch={params.q} currentVisibility={params.visibility} />

      {result.totalCount === 0 && !hasActiveFilter ? (
        <EmptyState icon={FolderTree} message={t("noCategoriesLabel")} description={t("noCategoriesDescription")} />
      ) : isOutOfRangePage ? (
        <EmptyState icon={FolderTree} message={t("categoriesNoResultsOnPageLabel")} />
      ) : result.items.length === 0 ? (
        <EmptyState icon={FolderTree} message={t("noCategoriesMatchLabel")} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.items.map((category) => (
            <div key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Link href={`/admin/categories/${category.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{category.name}</p>
                <p className="mt-0.5 text-xs text-foreground/40">
                  /{category.slug} · {category.children.length} {t("subcategoriesLabel")}
                </p>
              </Link>

              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getCategoryVisibilityStyle(category.visibilityStatus)}`}>
                  {t(getCategoryVisibilityTranslationKey(category.visibilityStatus))}
                </span>

                <form
                  action={async () => {
                    "use server";
                    await moveCategoryUp(category.id);
                    redirect({ href: "/admin/categories", locale });
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
                    await moveCategoryDown(category.id);
                    redirect({ href: "/admin/categories", locale });
                  }}
                >
                  <SubmitButton
                    aria-label={t("moveDownLabel")}
                    className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-accent/20 hover:text-foreground disabled:opacity-50"
                  >
                    <ArrowDown size={16} strokeWidth={1.75} />
                  </SubmitButton>
                </form>

                {category.visibilityStatus !== "ARCHIVED" && (
                  <form
                    action={async () => {
                      "use server";
                      const archiveResult = await archiveCategory(category.id);
                      if (!archiveResult.ok) {
                        redirect({ href: `/admin/categories?error=${archiveResult.error}`, locale });
                        return;
                      }
                      redirect({ href: "/admin/categories", locale });
                    }}
                  >
                    <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                      {t("archiveCategoryButton")}
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={categoriesBasePath} />
    </div>
  );
}
