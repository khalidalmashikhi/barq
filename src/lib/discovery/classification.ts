import { DISCOVERY_GROUPS, type DiscoveryGroupKey } from "./discovery-groups";

// BARQ Home Discovery — the pure, app-owned SERVICE-vs-EXPERIENCE classification
// used for customer-facing discovery grouping ONLY. It classifies by a category's
// STABLE slug, never by its translated label and never by serviceTypeKey.
//
// WHY serviceTypeKey is NOT sufficient: the Category.serviceTypeKey vertical
// (EXPERIENCE / TRANSPORT / RENTAL / …) is a TECHNICAL discriminator. The
// EXPERIENCE vertical contains BOTH tourism experiences (adventures, cultural-
// tours, local-experiences) AND a professional service (tourist-guides). So
// "serviceTypeKey === EXPERIENCE" cannot decide whether something is a
// customer-facing Experience — this classification does, keyed on slug.
//
// Nothing here alters Service.serviceType, the Experience CTI table, or any
// authorization — it is a read-only presentation classification.

const GROUP_BY_SLUG: ReadonlyMap<string, DiscoveryGroupKey> = new Map(
  DISCOVERY_GROUPS.flatMap((group) => group.categorySlugs.map((slug) => [slug, group.key] as const))
);

// The discovery group a real category slug belongs to, or null (fail-closed) for
// an unknown/unmapped slug — never guessed from a label or serviceTypeKey.
export function discoveryGroupForCategorySlug(slug: string): DiscoveryGroupKey | null {
  return GROUP_BY_SLUG.get(slug) ?? null;
}

// A customer-facing tourism EXPERIENCE (adventures / local-experiences /
// cultural-tours). Deliberately FALSE for `tourist-guides` — a professional
// service — even though its serviceTypeKey is EXPERIENCE.
export function isExperienceCategorySlug(slug: string): boolean {
  return discoveryGroupForCategorySlug(slug) === "EXPERIENCES";
}

// A professional-service category (tourist-guides / transport / car-rental) — the
// complement, among known slugs, of the EXPERIENCES group.
export function isProfessionalServiceCategorySlug(slug: string): boolean {
  const group = discoveryGroupForCategorySlug(slug);
  return group === "TOURIST_GUIDES" || group === "TRANSPORT" || group === "CAR_RENTAL";
}
