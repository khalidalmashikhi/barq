import Link from "next/link";
import { Search, X } from "lucide-react";
import { getCategoryVisibilityTranslationKey } from "@/lib/categories/presentation/category-visibility";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Category admin filters — Phase 1.2 (Category Admin UI). Mirrors
// src/components/provider/service-filters.tsx exactly: plain GET-form,
// no client JS, real removable filter chips — this codebase's
// established search/filter convention, not a new one.

const VISIBILITY_STATUSES = ["PUBLIC", "HIDDEN", "LINK_ONLY", "INVITE_ONLY", "SCHEDULED", "ARCHIVED"] as const;

type CategoryFiltersProps = {
  currentSearch?: string;
  currentVisibility?: string;
};

export async function CategoryFilters({ currentSearch, currentVisibility }: CategoryFiltersProps) {
  const t = await getServerTranslator("admin");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/admin/categories", locale });

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = { q: currentSearch, visibility: currentVisibility };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (currentSearch) chips.push({ key: "q", label: `"${currentSearch}"`, href: hrefWithout("q") });
  if (currentVisibility) {
    chips.push({ key: "visibility", label: t(getCategoryVisibilityTranslationKey(currentVisibility)), href: hrefWithout("visibility") });
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
          <input
            type="search"
            name="q"
            defaultValue={currentSearch}
            placeholder={t("categoriesSearchPlaceholder")}
            aria-label={t("categoriesSearchPlaceholder")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-xs font-medium text-foreground/50">{t("categoryVisibilityAll")}</span>
          <select
            name="visibility"
            defaultValue={currentVisibility ?? ""}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">{t("categoryVisibilityAll")}</option>
            {VISIBILITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(getCategoryVisibilityTranslationKey(status))}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("applyCategoryFiltersButton")}
        </button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground/40">{t("categoryActiveFiltersLabel")}</span>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {chip.label}
              <X size={12} strokeWidth={2} />
            </Link>
          ))}
          <Link href={basePath} className="text-xs font-medium text-foreground/40 underline-offset-2 hover:text-foreground/60 hover:underline">
            {t("categoryClearAllFiltersLabel")}
          </Link>
        </div>
      )}
    </div>
  );
}
