import { DISCOVERY_GROUPS, type DiscoveryGroupKey } from "./discovery-groups";

// BARQ Home Discovery — pure navigation-href builders (no react/prisma/next), so
// the Home components stay thin and the routing is unit-tested. Every href is a
// locale-AGNOSTIC internal path (the caller's <Link> prefixes the active locale);
// never an absolute/external URL.

function withRegion(path: string, region?: string | null): string {
  return region ? `${path}${path.includes("?") ? "&" : "?"}region=${encodeURIComponent(region)}` : path;
}

// A discovery group -> the group-scoped services listing. MORE is the "browse
// everything" catch-all (no group filter). Non-MORE groups carry ?group=<KEY>,
// which the services page resolves to the group's real category ids via the
// registry (product semantics, never a label).
export function discoveryGroupHref(groupKey: DiscoveryGroupKey, region?: string | null): string {
  if (groupKey === "MORE") return withRegion("/services", region);
  return withRegion(`/services?group=${groupKey}`, region);
}

// A single service card -> its public detail page.
export function serviceCardHref(id: string): string {
  return `/services/${id}`;
}

// An Explore-Oman governorate card -> the browse listing scoped to that region.
export function governorateBrowseHref(code: string): string {
  return withRegion("/services", code);
}

// A hero governorate chip -> the Home, re-scoped (feeds getHomeDiscovery so the
// previews update). "All Oman" clears the scope (no region).
export function homeGovernorateHref(code: string | null): string {
  return code ? withRegion("/", code) : "/";
}

// The ordered nav items for the "What are you looking for?" grid — the registry
// order is authoritative; MORE is always last and never a service bucket.
export type DiscoveryNavItem = { key: DiscoveryGroupKey; labelKey: string; iconKey: string; href: string };

export function discoveryNavItems(region?: string | null): DiscoveryNavItem[] {
  return [...DISCOVERY_GROUPS]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      key: group.key,
      labelKey: group.labelKey,
      iconKey: group.iconKey,
      href: discoveryGroupHref(group.key, region),
    }));
}

// Resolve a ?group=<KEY> query value to that group's real category slugs (for the
// services page's group-scoped listing). Unknown/invalid -> [] (fail-closed).
export function categorySlugsForGroup(groupKey: string): readonly string[] {
  const group = DISCOVERY_GROUPS.find((g) => g.key === groupKey);
  return group ? group.categorySlugs : [];
}
