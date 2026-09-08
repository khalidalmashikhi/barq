import { Building2, TreePalm, Mountain, Landmark, Waves, Sun, MapPin, type LucideIcon } from "lucide-react";
import type { RegionCode } from "@/lib/regions";

// UNIFIED GOVERNORATE ICON SYSTEM (UI polish gate) — the ONE source of truth mapping a
// canonical Oman governorate code (src/lib/regions REGION_CODES) to a lucide line icon. No
// page hardcodes a governorate→icon; they all render <GovernorateIcon code={...} />, which
// draws every icon from the SAME library at the SAME stroke and size inside the SAME
// container, so the set reads as one coherent family. The icon is a SUBTLE geographic cue —
// the governorate NAME beside it stays authoritative — and repetition across similar
// terrains (coast/desert/heritage) is intentional: consistency over forced uniqueness
// (never a photo, emoji, flag, or landmark drawing). PURELY presentational: this file holds
// no location/geo/filter/geography logic and never touches region data or ranking.
//
// Typed as Record<RegionCode, …> so the compiler guarantees all 11 governorates are covered;
// an unknown/absent code at runtime falls back to a neutral MapPin and never throws.
export const GOVERNORATE_ICONS: Record<RegionCode, LucideIcon> = {
  MUSCAT: Building2, // the capital — urban / buildings
  DHOFAR: TreePalm, // Salalah's monsoon greenery / palms
  MUSANDAM: Mountain, // the fjord peaks
  AL_BURAIMI: Landmark, // heritage oasis town
  AD_DAKHILIYAH: Landmark, // Nizwa / interior heritage heartland
  AL_BATINAH_NORTH: Waves, // northern coastal plain
  AL_BATINAH_SOUTH: Waves, // southern coastal plain
  ASH_SHARQIYAH_NORTH: Sun, // Wahiba desert edge
  ASH_SHARQIYAH_SOUTH: Waves, // Sur coastline
  ADH_DHAHIRAH: Mountain, // western Hajar foothills
  AL_WUSTA: Sun, // the central desert
};

// A generic, neutral fallback for any non-governed / unknown code — keeps the UI safe and
// consistent (same family) without pretending to identify a place we don't recognize.
const FALLBACK_ICON: LucideIcon = MapPin;

export function GovernorateIcon({
  code,
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  code: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const Icon = (GOVERNORATE_ICONS as Record<string, LucideIcon>)[code] ?? FALLBACK_ICON;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}
