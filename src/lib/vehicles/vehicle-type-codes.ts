// Canonical PHYSICAL vehicle-type registry — app-owned, pure (no server-only / prisma / next /
// tour-template import). These are physical body-type CODES (SEDAN/SUV/FOUR_BY_FOUR/VAN/MINIBUS/
// OTHER) shared by EVERY vehicle consumer — the general provider vehicle form (VEHICLE-2), the
// rental onboarding wizard (Phase 3C Slice 3B), and the guided-tour template alike.
//
// IMPORTANT — taxonomy is NOT authorization. Membership here describes what a vehicle physically IS;
// it confers NO commercial permission. Standalone rental eligibility is governed entirely by the
// RENTAL_COMPANY vertical (canViewRentalWorkspace / assertRentalDraftAuthorized) and a guided-tour
// vehicle's eligibility by the TOURIST_GUIDE vertical + pool assignment — never by a code appearing
// in this list. A guide's vehicle does not become rentable because its body type is also valid for
// rental. (This module was extracted from the former `tour-template/vehicle-types` so the rental
// domain no longer depends, even in name, on guided-tour code; that module now RE-EXPORTS these.)

// Bilingual-plus presentation label (ar/en required; other BARQ locales optional). Structurally
// identical to tour-template's LocalizedText so the re-exported defaults stay assignment-compatible,
// but defined here so this neutral module imports nothing from tour-template.
export type VehicleTypeLabel = {
  ar: string;
  en: string;
  de?: string;
  it?: string;
  pl?: string;
  fr?: string;
  cs?: string;
  ru?: string;
};

export const VEHICLE_TYPE_CODES = ["SEDAN", "SUV", "FOUR_BY_FOUR", "VAN", "MINIBUS", "OTHER"] as const;

export type VehicleTypeCode = (typeof VEHICLE_TYPE_CODES)[number];

const VEHICLE_TYPE_CODE_SET: ReadonlySet<string> = new Set(VEHICLE_TYPE_CODES);

export function isVehicleTypeCode(value: unknown): value is VehicleTypeCode {
  return typeof value === "string" && VEHICLE_TYPE_CODE_SET.has(value);
}

// Bounds for the optional vehicle sub-fields. MAX_VEHICLE_YEAR is a static sane upper bound (a
// listing may name a current-plus-one model year); intentionally not coupled to the wall clock.
export const MIN_VEHICLE_YEAR = 1950;
export const MAX_VEHICLE_YEAR = 2100;
export const MAX_VEHICLE_PASSENGER_CAPACITY = 100;

export type VehicleTypeDefault = {
  code: VehicleTypeCode;
  label: VehicleTypeLabel;
  sortOrder: number;
};

export const VEHICLE_TYPE_DEFAULTS: readonly VehicleTypeDefault[] = [
  { code: "SEDAN", sortOrder: 0, label: { ar: "سيارة سيدان", en: "Sedan", de: "Limousine", it: "Berlina", pl: "Sedan", fr: "Berline", cs: "Sedan", ru: "Седан" } },
  { code: "SUV", sortOrder: 1, label: { ar: "إس يو في (SUV)", en: "SUV", de: "SUV", it: "SUV", pl: "SUV", fr: "SUV", cs: "SUV", ru: "Внедорожник (SUV)" } },
  { code: "FOUR_BY_FOUR", sortOrder: 2, label: { ar: "دفع رباعي (4x4)", en: "4x4", de: "4x4", it: "4x4", pl: "4x4", fr: "4x4", cs: "4x4", ru: "4x4" } },
  { code: "VAN", sortOrder: 3, label: { ar: "فان", en: "Van", de: "Van", it: "Van", pl: "Van", fr: "Van", cs: "Van", ru: "Микроавтобус (Van)" } },
  { code: "MINIBUS", sortOrder: 4, label: { ar: "حافلة صغيرة", en: "Minibus", de: "Minibus", it: "Minibus", pl: "Minibus", fr: "Minibus", cs: "Minibus", ru: "Минибус" } },
  { code: "OTHER", sortOrder: 5, label: { ar: "أخرى", en: "Other", de: "Sonstige", it: "Altro", pl: "Inny", fr: "Autre", cs: "Jiné", ru: "Другое" } },
];
