// BARQ Home Discovery — the app-owned canonical discovery-group registry.
//
// PURE (no prisma/next/server-only/react) so it is unit-testable and importable
// anywhere. These are CUSTOMER-FACING DISCOVERY GROUPS ONLY — a presentation
// layer over the existing Category tree. They are NOT ProviderCategory
// permissions and grant NO authorization: B4/B5 remain the sole authority for
// which activities a provider may offer. A group maps to one or more REAL,
// STABLE category SLUGS (ADR-0016 taxonomy) — never to a translated label and
// never to the technical serviceTypeKey vertical.
//
// PRODUCT SEMANTICS over the CTI discriminator: `tourist-guides` has
// serviceTypeKey=EXPERIENCE, but it is a PROFESSIONAL SERVICE (the guide), so it
// belongs to TOURIST_GUIDES — NOT to the customer-facing EXPERIENCES group.
// Preventing that conflation is the whole point of this registry.

export const DISCOVERY_GROUP_KEYS = [
  "EXPERIENCES",
  "TOURIST_GUIDES",
  "TRANSPORT",
  "CAR_RENTAL",
  "MARINE_TRIPS",
  "MORE",
] as const;

export type DiscoveryGroupKey = (typeof DISCOVERY_GROUP_KEYS)[number];

export type DiscoveryGroup = {
  key: DiscoveryGroupKey;
  /// i18n key in the "landing" namespace (customer-facing).
  labelKey: string;
  /// Stable icon identifier resolved to a component in the presentation layer
  /// (keeps this module react-free).
  iconKey: string;
  /// The REAL category slugs (ADR-0016) this group previews. MORE is the
  /// catch-all "browse everything" group and intentionally has none.
  categorySlugs: readonly string[];
  sortOrder: number;
};

export const DISCOVERY_GROUPS: readonly DiscoveryGroup[] = [
  {
    key: "EXPERIENCES",
    labelKey: "discoveryExperiences",
    iconKey: "compass",
    // Tourism ACTIVITIES — deliberately EXCLUDES tourist-guides.
    categorySlugs: ["adventures", "local-experiences", "cultural-tours"],
    sortOrder: 0,
  },
  {
    key: "TOURIST_GUIDES",
    labelKey: "discoveryTouristGuides",
    iconKey: "userRound",
    categorySlugs: ["tourist-guides"],
    sortOrder: 1,
  },
  {
    key: "TRANSPORT",
    labelKey: "discoveryTransport",
    iconKey: "bus",
    categorySlugs: ["transfers"],
    sortOrder: 2,
  },
  {
    key: "CAR_RENTAL",
    labelKey: "discoveryCarRental",
    iconKey: "car",
    categorySlugs: ["cars"],
    sortOrder: 3,
  },
  {
    key: "MARINE_TRIPS",
    labelKey: "discoveryMarineTrips",
    iconKey: "ship",
    categorySlugs: ["marine-trips"],
    sortOrder: 4,
  },
  {
    key: "MORE",
    labelKey: "discoveryMore",
    iconKey: "layoutGrid",
    categorySlugs: [],
    sortOrder: 5,
  },
];

// All real category slugs referenced by any group (deduped) — used to resolve
// slugs -> ids in one bounded query.
export const ALL_DISCOVERY_CATEGORY_SLUGS: readonly string[] = Array.from(
  new Set(DISCOVERY_GROUPS.flatMap((group) => group.categorySlugs))
);
