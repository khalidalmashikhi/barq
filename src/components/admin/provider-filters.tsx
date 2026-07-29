import Link from "next/link";
import { Search, X } from "lucide-react";
import { getProviderStatusTranslationKey } from "@/lib/admin/presentation/provider-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Provider admin filters — Phase 2.2 (Provider Admin UI). Mirrors
// category-filters.tsx exactly: plain GET-form, no client JS, real
// removable filter chips — this codebase's established search/filter
// convention, not a new one.

const PROVIDER_STATUSES = ["APPLIED", "UNDER_REVIEW", "APPROVED", "SUSPENDED", "DEACTIVATED"] as const;

type ProviderFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
};

export async function ProviderFilters({ currentSearch, currentStatus }: ProviderFiltersProps) {
  const t = await getServerTranslator("admin");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/admin/providers", locale });

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = { q: currentSearch, status: currentStatus };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (currentSearch) chips.push({ key: "q", label: `"${currentSearch}"`, href: hrefWithout("q") });
  if (currentStatus) {
    chips.push({ key: "status", label: t(getProviderStatusTranslationKey(currentStatus)), href: hrefWithout("status") });
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
            placeholder={t("providersSearchPlaceholder")}
            aria-label={t("providersSearchPlaceholder")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-xs font-medium text-foreground/50">{t("providerStatusAll")}</span>
          <select
            name="status"
            defaultValue={currentStatus ?? ""}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">{t("providerStatusAll")}</option>
            {PROVIDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(getProviderStatusTranslationKey(status))}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("applyProviderFiltersButton")}
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
