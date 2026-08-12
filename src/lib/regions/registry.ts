// Oman governorate registry — the authoritative APPLICATION allow-list for
// Service.regionCode (Core Service Enrichment, Gate 3: domain read/write wiring).
//
// These 11 codes are the EXACT set enforced by the Gate-2 database CHECK
// constraint (services_regionCode_check, in migration
// 20260812120000_service_region_pricing_unit). The two MUST stay in sync — this
// file's test guards the count and shape, and the migration's own comment points
// back here. A code is a STABLE, language-neutral identifier (e.g. DHOFAR),
// NEVER a localized display name: presentation (Arabic "ظفار" / English "Dhofar"
// governorate labels) belongs to i18n message catalogs (ADR-0010), never to this
// registry, so the same code renders correctly in all 8 interface languages.
//
// Deliberately a String code registry, not a Prisma enum — the code-registry
// convention (ADR-0015), same as service-types/registry.ts: it avoids ALTER TYPE
// migrations and keeps the governed vocabulary in application code with an
// optional DB CHECK as defence-in-depth.
//
// Isomorphic: NO "server-only" import, so a future Gate-4 region <select> in a
// client component can import REGION_CODES directly, exactly like
// service-types/registry.ts.

export const REGION_CODES = [
  "MUSCAT",
  "DHOFAR",
  "MUSANDAM",
  "AL_BURAIMI",
  "AD_DAKHILIYAH",
  "AL_BATINAH_NORTH",
  "AL_BATINAH_SOUTH",
  "ASH_SHARQIYAH_NORTH",
  "ASH_SHARQIYAH_SOUTH",
  "ADH_DHAHIRAH",
  "AL_WUSTA",
] as const;

export type RegionCode = (typeof REGION_CODES)[number];

// Runtime type guard — the single source of truth for "is this a governed region
// code?". Rejects non-strings, localized names, and any value outside the set.
export function isValidRegionCode(value: unknown): value is RegionCode {
  return typeof value === "string" && (REGION_CODES as readonly string[]).includes(value);
}

// Domain parse helper for the create/update service actions — preferred over
// inline isValidRegionCode/includes checks at each call site (keeps trim/empty
// handling in ONE place). Three-state result lets a caller distinguish "unset"
// from "invalid" without extra branching:
//
//   - null        → absent or empty/whitespace input → the field is unset
//                   (create: persist no region; update: an explicit clear to NULL)
//   - a RegionCode → a governed, valid code
//   - undefined   → a NON-EMPTY value that is not a governed code → the caller
//                   rejects it (its existing INVALID_INPUT path) BEFORE any write
//
// NULL-tolerant by construction: legacy rows and unset fields simply yield null.
export function parseRegionCode(value: unknown): RegionCode | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return isValidRegionCode(trimmed) ? trimmed : undefined;
}
