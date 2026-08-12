import { isValidRegionCode, type RegionCode } from "./registry";

// Region presentation mapping (Core Service Enrichment, Gate 4).
//
// The registry (registry.ts) stays authoritative for VALIDITY; i18n stays
// authoritative for the human-readable LABEL. This module is the single bridge
// between them: governorate CODE -> a `common` namespace translation key. It is
// centralized here so every surface (provider/admin forms, public cards, service
// detail, provider preview, and the Explore filter) resolves labels the same way
// instead of hand-rolling its own code->label switch (Gate 4, item 12).
//
// Isomorphic (no "server-only") — a plain constant map + guard, safe on both
// server components (getServerTranslator) and client components (useTranslations).
export const REGION_LABEL_KEYS = {
  MUSCAT: "governorate.MUSCAT",
  DHOFAR: "governorate.DHOFAR",
  MUSANDAM: "governorate.MUSANDAM",
  AL_BURAIMI: "governorate.AL_BURAIMI",
  AD_DAKHILIYAH: "governorate.AD_DAKHILIYAH",
  AL_BATINAH_NORTH: "governorate.AL_BATINAH_NORTH",
  AL_BATINAH_SOUTH: "governorate.AL_BATINAH_SOUTH",
  ASH_SHARQIYAH_NORTH: "governorate.ASH_SHARQIYAH_NORTH",
  ASH_SHARQIYAH_SOUTH: "governorate.ASH_SHARQIYAH_SOUTH",
  ADH_DHAHIRAH: "governorate.ADH_DHAHIRAH",
  AL_WUSTA: "governorate.AL_WUSTA",
} as const satisfies Record<RegionCode, string>;

export type RegionLabelKey = (typeof REGION_LABEL_KEYS)[RegionCode];

// Safe code -> label-key resolution for presentation. Returns the translation key
// for a governed code, or null for null/absent/UNKNOWN values, so a caller omits
// the field rather than ever rendering a raw string (Gate 4, item 21). The DB
// CHECK guards regionCode, but presentation still fails safe if an unexpected
// value somehow reaches it.
export function regionLabelKey(code: string | null | undefined): RegionLabelKey | null {
  return code && isValidRegionCode(code) ? REGION_LABEL_KEYS[code] : null;
}
