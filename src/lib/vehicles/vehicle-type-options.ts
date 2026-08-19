import type { Locale } from "@/i18n/locales";
import { TOUR_VEHICLE_DEFAULTS } from "@/lib/tour-template/vehicle-types";

// VEHICLE-2 — the vehicle-type <select> options, REUSING the app-owned canonical
// registry (TOUR_VEHICLE_DEFAULTS: the same SEDAN/SUV/FOUR_BY_FOUR/VAN/MINIBUS/
// OTHER codes VEHICLE-1 validates, each already localized in all 8 BARQ locales).
// One vocabulary, never a competing one: the stored/submitted VALUE is always the
// untranslated canonical `code`; only the human LABEL is localized here.

export type VehicleTypeOption = { code: string; label: string };

export function vehicleTypeOptions(locale: Locale): VehicleTypeOption[] {
  return [...TOUR_VEHICLE_DEFAULTS]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option) => ({ code: option.code, label: option.label[locale] ?? option.label.en }));
}
