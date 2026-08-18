import type { Metadata } from "next";
import { PackageOpen } from "lucide-react";
import { getServices, getProvidersForFilter } from "@/lib/services/get-services";
import { getPublicCategoryBySlug } from "@/lib/categories/get-public-category-by-slug";
import { categorySlugsForGroup } from "@/lib/discovery/home-nav";
import { isValidRegionCode, regionLabelKey } from "@/lib/regions";
import { pricingUnitLabelKey } from "@/lib/pricing-units";
import { ServiceFilters } from "@/components/services/service-filters";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { FadeIn } from "@/components/ui/fade-in";

type SearchParams = {
  q?: string;
  providerId?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
  category?: string;
  group?: string;
  region?: string;
};

// UX REMEDIATION (category navigation fix) — resolveCategoryLabel()
// is the one place a homepage/dashboard category slug is translated
// back into its own real, already-existing display label (the exact
// same string CategoriesSection/CategoryExplorer already render), for
// two uses below: showing "Category: {label}" as a real active-filter
// chip, and feeding that label into getServices() as the best-effort
// categoryKeyword match (see get-services.ts's own comment for why a
// keyword match, not a true category filter — Service has no
// relationship to the real Category/SubCategory models). An unknown
// slug (e.g. a hand-edited URL) resolves to undefined and is silently
// ignored — no chip, no filter — the same graceful behavior an unknown
// providerId already gets below.
const LANDING_CATEGORY_SLUGS = [
  "desert-safari",
  "mountain-tours",
  "coastal-trips",
  "cultural-tours",
  "city-experiences",
  "adventure-sports",
] as const;

const DASHBOARD_CATEGORY_SLUGS = ["mountains", "beaches", "desert", "transport", "camping", "photography", "diving"] as const;

async function resolveCategoryLabel(slug: string | undefined): Promise<string | undefined> {
  if (!slug) return undefined;

  if ((LANDING_CATEGORY_SLUGS as readonly string[]).includes(slug)) {
    const t = await getServerTranslator("landing");
    switch (slug) {
      case "desert-safari":
        return t("categories.desertSafari");
      case "mountain-tours":
        return t("categories.mountainTours");
      case "coastal-trips":
        return t("categories.coastalTrips");
      case "cultural-tours":
        return t("categories.culturalTours");
      case "city-experiences":
        return t("categories.cityExperiences");
      case "adventure-sports":
        return t("categories.adventureSports");
    }
  }

  if ((DASHBOARD_CATEGORY_SLUGS as readonly string[]).includes(slug)) {
    const t = await getServerTranslator("dashboard");
    switch (slug) {
      case "mountains":
        return t("categoryMountains");
      case "beaches":
        return t("categoryBeaches");
      case "desert":
        return t("categoryDesert");
      case "transport":
        return t("categoryTransport");
      case "camping":
        return t("categoryCamping");
      case "photography":
        return t("categoryPhotography");
      case "diving":
        return t("categoryDiving");
    }
  }

  return undefined;
}

// Phase B Group 5 — SEO/hreflang: deliberately ignores searchParams —
// filter/sort/page query-string state must not fragment the canonical
// across combinations, so this always canonicalizes to the bare
// "/services" path regardless of which query string the request used.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tServices = await getServerTranslator("services");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/services",
    title: tSeo("pageTitleTemplate", { page: tServices("title"), appName: tCommon("appName") }),
    description: tSeo("servicesListDescription"),
  });
}

export default async function ServicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const t = await getServerTranslator("services");
  const locale = await getLocale();
  const basePath = getPathname({ href: "/services", locale });

  // DUAL READ (B2 Slice 1): resolve the ?category=<slug> to a real, effectively
  // PUBLIC Category first; when found, filter by the relational categoryId. Only
  // when the slug is NOT a public category do we fall back to the legacy keyword
  // bridge (the hardcoded marketing slugs via resolveCategoryLabel). The active-
  // filter chip label comes from whichever path resolved it. Nothing legacy is
  // removed — this is purely additive.
  const publicCategory = params.category ? await getPublicCategoryBySlug(params.category) : null;
  const legacyCategoryLabel = publicCategory ? undefined : await resolveCategoryLabel(params.category);
  const categoryLabel = publicCategory?.label ?? legacyCategoryLabel;

  // HOME-1 discovery-group scope: a ?group=<KEY> from the Home "What are you
  // looking for?" grid resolves — via the app-owned registry, never a label — to
  // that group's real, currently-public Category ids. A group can span several
  // categories (e.g. EXPERIENCES), so this yields a categoryIds[] the reader ANDs
  // in. MORE (and any unknown key) resolves to no slugs → no group filter, i.e.
  // the "browse everything" catch-all — never an unfiltered dump masquerading as a
  // bucket. This composes with ?category/?region/etc.; it does not replace them.
  const groupSlugs = params.group ? categorySlugsForGroup(params.group) : [];
  const groupCategories = groupSlugs.length
    ? (await Promise.all(groupSlugs.map((slug) => getPublicCategoryBySlug(slug)))).filter(
        (c): c is NonNullable<typeof c> => c !== null,
      )
    : [];
  const groupCategoryIds = groupCategories.map((c) => c.id);

  // Governorate discovery filter (Gate 4): only a valid governed CODE narrows the
  // query. An unknown/hand-edited ?region= silently resolves to undefined and is
  // ignored — the same graceful behaviour an unknown providerId/category gets.
  const regionCode = params.region && isValidRegionCode(params.region) ? params.region : undefined;

  const tCommon = await getServerTranslator("common");

  const [providers, result] = await Promise.all([
    getProvidersForFilter(),
    getServices({
      search: params.q,
      providerId: params.providerId,
      minPrice: params.minPrice ? Number(params.minPrice) : undefined,
      maxPrice: params.maxPrice ? Number(params.maxPrice) : undefined,
      sort: (params.sort as "newest" | "price_asc" | "price_desc" | undefined) ?? "newest",
      page: params.page ? Number(params.page) : 1,
      // A resolved discovery group (?group=) narrows by its real category ids;
      // otherwise the single ?category= id / legacy keyword path is untouched.
      categoryIds: groupCategoryIds.length ? groupCategoryIds : undefined,
      categoryId: publicCategory?.id,
      categoryKeyword: legacyCategoryLabel,
      // Composes (AND) with categoryId/keyword and every other filter.
      regionCode,
    }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {result.totalCount > 0 ? t("availableCount", { count: result.totalCount }) : t("exploreAvailable")}
          </p>
        </div>

        <ServiceFilters
          providers={providers}
          currentSearch={params.q}
          currentProviderId={params.providerId}
          currentMinPrice={params.minPrice}
          currentMaxPrice={params.maxPrice}
          currentSort={params.sort}
          currentCategory={params.category}
          currentCategoryLabel={categoryLabel}
          currentRegion={regionCode}
        />

        {result.items.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            iconSize={32}
            gap="gap-3"
            padding="py-16"
            message={
              params.q || params.providerId || params.minPrice || params.maxPrice || categoryLabel || regionCode || groupCategoryIds.length
                ? t("noResultsMatchLabel")
                : t("noPublishedServicesLabel")
            }
            messageClassName="text-foreground/60"
          />
        ) : (
          <FadeIn className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((service) => {
              // Resolve governorate + pricing-unit for display, server-side, so the
              // client card keeps receiving ready strings (never raw codes). Both
              // fail safe: an unknown/absent code yields no label (region omitted;
              // price shown without a unit).
              const regionKey = regionLabelKey(service.regionCode);
              const unitKey = pricingUnitLabelKey(service.pricingUnit);
              const priceDisplay =
                service.price && unitKey
                  ? tCommon("priceWithUnit", { price: service.price, unit: tCommon(unitKey) })
                  : service.price;
              return (
                <ExperienceCard
                  key={service.id}
                  serviceId={service.id}
                  title={service.name}
                  providerName={service.providerName}
                  price={priceDisplay}
                  location={regionKey ? tCommon(regionKey) : undefined}
                  coverImageUrl={service.coverUrl}
                  imageAspect="premium"
                />
              );
            })}
          </FadeIn>
        )}

        <Pagination page={result.page} totalPages={result.totalPages} searchParams={params} basePath={basePath} />
      </main>
      <Footer />
    </div>
  );
}
