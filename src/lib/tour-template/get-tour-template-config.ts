import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import { resolveConfigText } from "./localize-config";
import { TOUR_PACKAGE_DEFAULTS, TOUR_PACKAGE_SEMANTICS, type TourPackageKey } from "./packages";
import { TOUR_VEHICLE_DEFAULTS, type TourVehicleCode } from "./vehicle-types";
import { TOUR_TEMPLATE_TEXT_DEFAULTS, isTourTemplateTextKey } from "./template-text";
import { TOUR_FIELD_RULE_DEFAULTS, isTourFieldKey, type TourFieldKey } from "./field-registry";

// Smart Tour-Guide Template — fail-closed CONFIG READERS.
//
// Each reader OVERLAYS admin-editable DB rows on the app-owned code defaults,
// iterating only the CANONICAL keys/codes — so a DB row with an unknown key is
// ignored (never offered/rendered), and if the DB is empty the readers return the
// built-in defaults. Behavioural semantics (includes-transport / requires-4x4)
// always come from code, never the DB. Localization falls back requested → en →
// built-in default (resolveConfigText). server-only: these touch prisma.

export type TourPackageOption = {
  key: TourPackageKey;
  label: string;
  description: string;
  includesTransport: boolean;
  requiresFourByFour: boolean;
};

export async function getEnabledTourPackages(locale: Locale): Promise<TourPackageOption[]> {
  const rows = await prisma.tourPackagePreset.findMany({
    select: { key: true, label: true, description: true, enabled: true, sortOrder: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return TOUR_PACKAGE_DEFAULTS.map((def, index) => {
    const row = byKey.get(def.key);
    const semantics = TOUR_PACKAGE_SEMANTICS[def.key];
    return {
      enabled: row ? row.enabled : true,
      sortOrder: row ? row.sortOrder : def.sortOrder,
      index,
      option: {
        key: def.key,
        label: resolveConfigText(row ? row.label : def.label, locale, def.label.en),
        description: resolveConfigText(row ? row.description : def.description, locale, def.description.en),
        includesTransport: semantics.includesTransport,
        requiresFourByFour: semantics.requiresFourByFour,
      } satisfies TourPackageOption,
    };
  })
    .filter((entry) => entry.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map((entry) => entry.option);
}

export type TourVehicleOption = { code: TourVehicleCode; label: string };

export async function getEnabledTourVehicleTypes(locale: Locale): Promise<TourVehicleOption[]> {
  const rows = await prisma.tourVehicleTypeOption.findMany({
    select: { code: true, label: true, enabled: true, sortOrder: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r]));

  return TOUR_VEHICLE_DEFAULTS.map((def, index) => {
    const row = byCode.get(def.code);
    return {
      enabled: row ? row.enabled : true,
      sortOrder: row ? row.sortOrder : def.sortOrder,
      index,
      option: { code: def.code, label: resolveConfigText(row ? row.label : def.label, locale, def.label.en) },
    };
  })
    .filter((entry) => entry.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map((entry) => entry.option);
}

// A known template-text key always resolves to SOME string (row when enabled,
// else the built-in default). An unknown key returns null (never rendered).
export async function getTourTemplateText(key: string, locale: Locale): Promise<string | null> {
  if (!isTourTemplateTextKey(key)) return null;
  const def = TOUR_TEMPLATE_TEXT_DEFAULTS.find((d) => d.key === key)!;
  const row = await prisma.tourTemplateText.findUnique({ where: { key }, select: { content: true, enabled: true } });
  if (row && row.enabled) {
    return resolveConfigText(row.content, locale, def.content.en);
  }
  return resolveConfigText(def.content, locale, def.content.en);
}

export type TourFieldRule = {
  key: TourFieldKey;
  visible: boolean;
  required: boolean;
  sortOrder: number;
  label: string | null;
  helpText: string | null;
};

export async function getTourFieldRules(locale: Locale): Promise<TourFieldRule[]> {
  const rows = await prisma.tourTemplateFieldRule.findMany({
    select: { key: true, visible: true, required: true, sortOrder: true, label: true, helpText: true },
  });
  // Drop DB rows whose key is not an app-owned field key — unknown keys never
  // create a form field (the application owns the registry).
  const byKey = new Map(rows.filter((r) => isTourFieldKey(r.key)).map((r) => [r.key, r]));

  return TOUR_FIELD_RULE_DEFAULTS.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      visible: row ? row.visible : def.visible,
      required: row ? row.required : def.required,
      sortOrder: row ? row.sortOrder : def.sortOrder,
      label: row && row.label != null ? resolveConfigText(row.label, locale, "") || null : null,
      helpText: row && row.helpText != null ? resolveConfigText(row.helpText, locale, "") || null : null,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}
