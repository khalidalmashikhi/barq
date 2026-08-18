import { Compass, UserRound, Bus, Car, Ship, LayoutGrid, type LucideIcon } from "lucide-react";

// Maps a discovery group's registry `iconKey` (an app-owned, stable string — see
// src/lib/discovery/discovery-groups.ts) to a concrete lucide icon. Kept as a
// presentation-only lookup so the registry stays free of React/icon imports.
// Unknown keys fall back to the neutral grid glyph (fail-safe, never throws).
const ICONS: Record<string, LucideIcon> = {
  compass: Compass,
  userRound: UserRound,
  bus: Bus,
  car: Car,
  ship: Ship,
  layoutGrid: LayoutGrid,
};

export function discoveryIcon(iconKey: string): LucideIcon {
  return ICONS[iconKey] ?? LayoutGrid;
}
