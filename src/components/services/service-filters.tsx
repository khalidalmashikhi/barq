import Link from "next/link";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";

// Service filters — Engineering Sprint (Services Marketplace); Phase
// F.2 (Search Experience) visual + UX pass.
//
// NO governorate control here, deliberately — building a disabled/fake
// control for a field that doesn't exist would be worse than omitting
// it; see get-services.ts's own note on why. A plain GET form (no
// client JS) so search/filter state lives entirely in the URL — real
// server-side filtering, shareable/bookmarkable URLs, no client-side
// state duplication. Phase F.2 does not change this architecture — it
// adds visible field labels and a real "active filters" chip row (each
// chip is a plain link removing exactly that param, reusing the same
// URL-is-the-state-machine model, not a new client-side filter store).
//
// CATEGORY — UX remediation (category navigation fix): `category`
// (the stable slug from a homepage/dashboard category card) is
// preserved via a hidden input, so submitting this visible form (a new
// search, a price range, a different sort) never silently drops it —
// the same "preserve every other active filter" behavior every other
// param here already gets. `currentCategoryLabel` (already resolved by
// services/page.tsx) is what the chip displays; see get-services.ts's
// own comment for why this is a best-effort keyword match, not a
// database-backed category filter.

type ServiceFiltersProps = {
  providers: Array<{ id: string; name: string }>;
  currentSearch?: string;
  currentProviderId?: string;
  currentMinPrice?: string;
  currentMaxPrice?: string;
  currentSort?: string;
  currentCategory?: string;
  currentCategoryLabel?: string;
};

type ActiveFilterChip = {
  key: string;
  label: string;
  href: string;
};

export async function ServiceFilters({
  providers,
  currentSearch,
  currentProviderId,
  currentMinPrice,
  currentMaxPrice,
  currentSort,
  currentCategory,
  currentCategoryLabel,
}: ServiceFiltersProps) {
  const t = await getServerTranslator("services");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/services", locale });

  const providerName = currentProviderId ? providers.find((p) => p.id === currentProviderId)?.name : undefined;

  function hrefWithout(...keys: string[]): string {
    const params = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      q: currentSearch,
      minPrice: currentMinPrice,
      maxPrice: currentMaxPrice,
      providerId: currentProviderId,
      sort: currentSort,
      category: currentCategory,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips: ActiveFilterChip[] = [];
  // Category chip listed first — it's the entry point a user actually
  // clicked to arrive here (from a homepage/dashboard card), so it
  // reads as the primary applied filter, not an afterthought.
  if (currentCategory && currentCategoryLabel) {
    chips.push({ key: "category", label: t("chipCategoryLabel", { value: currentCategoryLabel }), href: hrefWithout("category") });
  }
  if (currentSearch) chips.push({ key: "q", label: t("chipSearchLabel", { value: currentSearch }), href: hrefWithout("q") });
  if (currentMinPrice || currentMaxPrice) {
    const label =
      currentMinPrice && currentMaxPrice
        ? t("chipPriceRangeLabel", { min: currentMinPrice, max: currentMaxPrice })
        : currentMinPrice
          ? t("chipPriceMinLabel", { min: currentMinPrice })
          : t("chipPriceMaxLabel", { max: currentMaxPrice! });
    chips.push({ key: "price", label, href: hrefWithout("minPrice", "maxPrice") });
  }
  if (currentProviderId && providerName) {
    chips.push({ key: "providerId", label: providerName, href: hrefWithout("providerId") });
  }
  if (currentSort && currentSort !== "newest") {
    const sortLabel = currentSort === "price_asc" ? t("sortPriceAsc") : currentSort === "price_desc" ? t("sortPriceDesc") : currentSort;
    chips.push({ key: "sort", label: sortLabel, href: hrefWithout("sort") });
  }

  const hasSecondaryFilters = Boolean(currentMinPrice || currentMaxPrice || currentProviderId || (currentSort && currentSort !== "newest"));

  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-premium">
        {/* Preserves the category filter across every other submission
            of this form (search, price range, sort) — the same
            "don't silently drop an active filter" rule every other
            param here already gets. */}
        {currentCategory && <input type="hidden" name="category" value={currentCategory} />}
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-3 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search size={18} strokeWidth={1.75} className="shrink-0 text-foreground/40" />
          <input
            type="search"
            name="q"
            defaultValue={currentSearch}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("searchButton")}
          </button>
        </div>

        {/* Native <details> disclosure — zero JS, fully keyboard/screen-reader
            accessible via the built-in <summary> semantics. Secondary
            filters stay out of the way until requested, but auto-open when
            one is already active via a URL param, so an applied filter is
            never hidden from view. */}
        <details className="group" open={hasSecondaryFilters}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground/60 marker:content-none hover:text-foreground">
            <SlidersHorizontal size={14} strokeWidth={1.75} />
            {t("moreFiltersLabel")}
          </summary>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("minPriceLabel")}</span>
              <input
                type="number"
                name="minPrice"
                min="0"
                defaultValue={currentMinPrice}
                placeholder={t("minPricePlaceholder")}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("maxPriceLabel")}</span>
              <input
                type="number"
                name="maxPrice"
                min="0"
                defaultValue={currentMaxPrice}
                placeholder={t("maxPricePlaceholder")}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("providerLabel")}</span>
              <select
                name="providerId"
                defaultValue={currentProviderId ?? ""}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">{t("allProvidersLabel")}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/50">{t("sortLabel")}</span>
              <select
                name="sort"
                defaultValue={currentSort ?? "newest"}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="newest">{t("sortNewest")}</option>
                <option value="price_asc">{t("sortPriceAsc")}</option>
                <option value="price_desc">{t("sortPriceDesc")}</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            className="mt-3 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t("applyFiltersButton")}
          </button>
        </details>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground/40">{t("activeFiltersLabel")}</span>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {chip.label}
              <X size={12} strokeWidth={2} />
            </Link>
          ))}
          <Link href={basePath} className="text-xs font-medium text-foreground/40 underline-offset-2 hover:text-foreground/60 hover:underline">
            {t("clearAllFiltersLabel")}
          </Link>
        </div>
      )}
    </div>
  );
}
