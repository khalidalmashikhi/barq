import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import { getServices, type ServiceListItem } from "@/lib/services/get-services";
import type { Bookability } from "@/lib/services/bookability";
import { publicCategoryWhere } from "@/lib/categories/public-category-rule";
import { DISCOVERY_GROUPS, ALL_DISCOVERY_CATEGORY_SLUGS, type DiscoveryGroupKey } from "./discovery-groups";
import { REGION_CODES, isValidRegionCode, regionLabelKey } from "@/lib/regions";

// BARQ Home Discovery — the ONE server read-model a future clean Home (Web) and
// native (iOS/Android, via /api/v1/discovery/home) both consume. It composes the
// app-owned discovery groups with the existing public Service reader, so the
// SAME security predicate applies (getServices already filters PUBLISHED +
// provider APPROVED+visible) — no draft/private leakage. Everything is bounded:
// a small preview per group + a small recommended set, never a feed.

const PREVIEW_LIMIT = 6;
const RECOMMENDED_LIMIT = 6;

// Intentionally MINIMAL card — image + title + at most one/two facts. No
// description, provider-private data, status, objectKey, admin flags, or
// verification data (all excluded by construction: only these fields are copied).
export type DiscoveryCard = {
  id: string;
  name: string;
  coverUrl: string | null;
  regionCode: string | null;
  price: string | null;
  // Discovery & Detail Truthfulness — `priceIsFrom` lets the card show "From X" only
  // when there really is a range (the Home card previously hard-coded "From {price}").
  // `bookability` is the shared, server-derived availability state (never a raw blocker).
  priceIsFrom: boolean;
  bookability: Bookability;
};

export type DiscoveryGroupPreview = {
  key: DiscoveryGroupKey;
  labelKey: string;
  iconKey: string;
  categorySlugs: readonly string[];
  previewItems: DiscoveryCard[];
};

export type HomeGovernorate = { code: string; labelKey: string };

export type HomeDiscovery = {
  governorates: HomeGovernorate[];
  selectedGovernorate: string | null;
  groups: DiscoveryGroupPreview[];
  recommended: DiscoveryCard[];
  // Explore Oman — governorate metadata only (no destination imagery source
  // exists yet; visual curation is deferred).
  destinations: HomeGovernorate[];
};

function toCard(item: ServiceListItem): DiscoveryCard {
  return {
    id: item.id,
    name: item.name,
    coverUrl: item.coverUrl,
    regionCode: item.regionCode,
    price: item.price,
    priceIsFrom: item.priceIsFrom,
    bookability: item.bookability,
  };
}

function governorates(): HomeGovernorate[] {
  const list: HomeGovernorate[] = [];
  for (const code of REGION_CODES) {
    const labelKey = regionLabelKey(code);
    if (labelKey) list.push({ code, labelKey });
  }
  return list;
}

export async function getHomeDiscovery(params: { regionCode?: string | null; locale: Locale }): Promise<HomeDiscovery> {
  const { locale } = params;
  const selectedGovernorate = params.regionCode && isValidRegionCode(params.regionCode) ? params.regionCode : null;
  const regionFilter = selectedGovernorate ? { regionCode: selectedGovernorate } : {};

  // Resolve the groups' real category slugs -> ids in ONE bounded, PUBLIC-only
  // query. An unknown/hidden slug simply does not resolve (fail-closed).
  const categoryRows =
    ALL_DISCOVERY_CATEGORY_SLUGS.length > 0
      ? await prisma.category.findMany({
          where: { slug: { in: [...ALL_DISCOVERY_CATEGORY_SLUGS] }, ...publicCategoryWhere() },
          select: { id: true, slug: true },
        })
      : [];
  const idBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

  const groups: DiscoveryGroupPreview[] = await Promise.all(
    DISCOVERY_GROUPS.map(async (group) => {
      const ids = group.categorySlugs
        .map((slug) => idBySlug.get(slug))
        .filter((id): id is string => typeof id === "string");

      // A group with configured slugs but NONE resolvable -> empty preview (never
      // an unfiltered dump). MORE (no slugs) -> latest across all categories.
      const skip = group.categorySlugs.length > 0 && ids.length === 0;
      let items: ServiceListItem[] = [];
      if (!skip) {
        const result = await getServices(
          { ...regionFilter, ...(ids.length > 0 ? { categoryIds: ids } : {}), sort: "newest", page: 1, pageSize: PREVIEW_LIMIT },
          locale
        );
        items = result.items;
      }

      return {
        key: group.key,
        labelKey: group.labelKey,
        iconKey: group.iconKey,
        categorySlugs: group.categorySlugs,
        previewItems: items.map(toCard),
      };
    })
  );

  // Recommended — a deterministic, safe subset (latest PUBLISHED, governorate-
  // scoped, small limit). NOT personalized / AI; simply current-data curation.
  const recommended = await getServices({ ...regionFilter, sort: "newest", page: 1, pageSize: RECOMMENDED_LIMIT }, locale);

  const govs = governorates();
  return {
    governorates: govs,
    selectedGovernorate,
    groups,
    recommended: recommended.items.map(toCard),
    destinations: govs,
  };
}
