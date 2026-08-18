import "server-only";
import type { Locale } from "@/i18n/locales";
import {
  getEnabledTourPackages,
  getEnabledTourVehicleTypes,
  getTourFieldRules,
  getTourTemplateText,
  type TourPackageOption,
  type TourVehicleOption,
  type TourFieldRule,
} from "../get-tour-template-config";

// Smart Tour-Guide Template — the ONE effective-config composer for the provider
// form (TOUR-2). Works WITHOUT bootstrap: every reader falls back to the built-in
// app defaults when the DB tables are empty (Phase 14), so the form always
// renders a complete, usable configuration. Returns a plain serializable object
// safe to pass from the server page into the client form.

export type SmartTourFormConfig = {
  intro: string | null;
  packages: TourPackageOption[];
  vehicleTypes: TourVehicleOption[];
  fields: TourFieldRule[];
};

export async function getSmartTourFormConfig(locale: Locale): Promise<SmartTourFormConfig> {
  const [intro, packages, vehicleTypes, fields] = await Promise.all([
    getTourTemplateText("template.intro", locale),
    getEnabledTourPackages(locale),
    getEnabledTourVehicleTypes(locale),
    getTourFieldRules(locale),
  ]);
  return { intro, packages, vehicleTypes, fields };
}
