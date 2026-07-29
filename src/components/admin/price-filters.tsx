import Link from "next/link";
import { Search, X } from "lucide-react";
import { getPriceStatusTranslationKey } from "@/lib/admin/presentation/price-status";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Price admin filters — Phase 2.6 (Pricing Admin UI). Mirrors
// service-filters.tsx's plain-GET-form/removable-chip shape exactly,
// with one deliberate difference: Price has no name field of its own
// (unlike Provider's businessName or Service's name), so "Search" here
// filters by exact Service ID — reusing getPrices()'s existing
// `serviceId` filter verbatim rather than adding a new backend text-
// search capability this phase's own scope doesn't ask for. Flagged
// explicitly in this phase's Pattern Regression Check.

const PRICE_STATUSES = ["ACTIVE", "SUPERSEDED"] as const;

type PriceFiltersProps = {
  currentServiceId?: string;
  currentStatus?: string;
};

export async function PriceFilters({ currentServiceId, currentStatus }: PriceFiltersProps) {
  const t = await getServerTranslator("admin");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/admin/prices", locale });

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = { serviceId: currentServiceId, status: currentStatus };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (currentServiceId) chips.push({ key: "serviceId", label: `"${currentServiceId}"`, href: hrefWithout("serviceId") });
  if (currentStatus) {
    chips.push({ key: "status", label: t(getPriceStatusTranslationKey(currentStatus)), href: hrefWithout("status") });
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search size={16} strokeWidth={1.75} className="text-foreground/40" />
          <input
            type="search"
            name="serviceId"
            defaultValue={currentServiceId}
            dir="ltr"
            placeholder={t("pricesSearchPlaceholder")}
            aria-label={t("pricesSearchPlaceholder")}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
        </div>

        <label className="flex flex-col gap-1.5 sm:w-64">
          <span className="text-xs font-medium text-foreground/50">{t("priceStatusAll")}</span>
          <select
            name="status"
            defaultValue={currentStatus ?? ""}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">{t("priceStatusAll")}</option>
            {PRICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(getPriceStatusTranslationKey(status))}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("applyPriceFiltersButton")}
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
