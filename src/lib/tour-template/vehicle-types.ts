// Smart Tour-Guide Template — canonical VEHICLE-TYPE registry (app-owned).
//
// Pure (no server-only/prisma/next). The canonical `code` set and their server
// semantics are owned by application code — FOUR_BY_FOUR in particular is
// structurally meaningful (GUIDE_WITH_4X4 requires it). Admin may localize the
// label, enable/disable, and reorder an option (see TourVehicleTypeOption), but
// may NOT invent an arbitrary semantic code: a DB row whose `code` is not in this
// set is ignored by the reader (fail-closed), never offered as a choice.

import type { LocalizedText } from "./localized-text";

export const TOUR_VEHICLE_CODES = ["SEDAN", "SUV", "FOUR_BY_FOUR", "VAN", "MINIBUS", "OTHER"] as const;

export type TourVehicleCode = (typeof TOUR_VEHICLE_CODES)[number];

const VEHICLE_CODE_SET: ReadonlySet<string> = new Set(TOUR_VEHICLE_CODES);

export function isTourVehicleCode(value: unknown): value is TourVehicleCode {
  return typeof value === "string" && VEHICLE_CODE_SET.has(value);
}

// Bounds for the optional vehicle sub-fields (enforced by the guidingContent
// contract). MAX_VEHICLE_YEAR is a static sane upper bound (a listing may name a
// current-plus-one model year); intentionally not coupled to the wall clock.
export const MIN_VEHICLE_YEAR = 1950;
export const MAX_VEHICLE_YEAR = 2100;
export const MAX_VEHICLE_PASSENGER_CAPACITY = 100;

export type TourVehicleDefault = {
  code: TourVehicleCode;
  label: LocalizedText;
  sortOrder: number;
};

export const TOUR_VEHICLE_DEFAULTS: readonly TourVehicleDefault[] = [
  { code: "SEDAN", sortOrder: 0, label: { ar: "سيارة سيدان", en: "Sedan", de: "Limousine", it: "Berlina", pl: "Sedan", fr: "Berline", cs: "Sedan", ru: "Седан" } },
  { code: "SUV", sortOrder: 1, label: { ar: "إس يو في (SUV)", en: "SUV", de: "SUV", it: "SUV", pl: "SUV", fr: "SUV", cs: "SUV", ru: "Внедорожник (SUV)" } },
  { code: "FOUR_BY_FOUR", sortOrder: 2, label: { ar: "دفع رباعي (4x4)", en: "4x4", de: "4x4", it: "4x4", pl: "4x4", fr: "4x4", cs: "4x4", ru: "4x4" } },
  { code: "VAN", sortOrder: 3, label: { ar: "فان", en: "Van", de: "Van", it: "Van", pl: "Van", fr: "Van", cs: "Van", ru: "Микроавтобус (Van)" } },
  { code: "MINIBUS", sortOrder: 4, label: { ar: "حافلة صغيرة", en: "Minibus", de: "Minibus", it: "Minibus", pl: "Minibus", fr: "Minibus", cs: "Minibus", ru: "Минибус" } },
  { code: "OTHER", sortOrder: 5, label: { ar: "أخرى", en: "Other", de: "Sonstige", it: "Altro", pl: "Inny", fr: "Autre", cs: "Jiné", ru: "Другое" } },
];
