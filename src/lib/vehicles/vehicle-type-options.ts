import type { Locale } from "@/i18n/locales";
import { VEHICLE_TYPE_DEFAULTS } from "@/lib/vehicles/vehicle-type-codes";

// VEHICLE-2 — the vehicle-type <select> options, REUSING the neutral app-owned
// registry (VEHICLE_TYPE_DEFAULTS: the same SEDAN/SUV/FOUR_BY_FOUR/VAN/MINIBUS/
// OTHER physical codes VEHICLE-1 validates, each already localized in all 8 BARQ
// locales). One vocabulary, never a competing one: the stored/submitted VALUE is
// always the untranslated canonical `code`; only the human LABEL is localized here.

export type VehicleTypeOption = { code: string; label: string };

export function vehicleTypeOptions(locale: Locale): VehicleTypeOption[] {
  return [...VEHICLE_TYPE_DEFAULTS]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option) => ({ code: option.code, label: option.label[locale] ?? option.label.en }));
}
