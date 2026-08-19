// VEHICLE-1 — stable domain error codes for provider vehicle mutations. Callers
// map these to localized messages later (VEHICLE-2/1B); raw Prisma errors are
// never surfaced.

export const VEHICLE_ACTION_ERROR_CODES = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "PROVIDER_NOT_APPROVED",
  // A vehicle with this registration number already exists. Deliberately generic:
  // it never reveals WHICH provider owns it (the unique index is global).
  "DUPLICATE_REGISTRATION",
  // The vehicle does not exist OR is not owned by the caller — one code, so a
  // provider can never probe another provider's vehicle ids.
  "VEHICLE_NOT_FOUND",
  "UNKNOWN_ERROR",
] as const;

export type VehicleActionErrorCode = (typeof VEHICLE_ACTION_ERROR_CODES)[number];

export function isVehicleActionErrorCode(value: unknown): value is VehicleActionErrorCode {
  return typeof value === "string" && (VEHICLE_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

// Provider-namespace translation keys for surfacing a vehicle-action error on the
// Web forms (same pattern as availability-action-errors.ts). Locale-neutral map;
// the page resolves the actual string via next-intl.
const VEHICLE_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "vehicleErrorInvalidInput",
  NO_PROVIDER_PROFILE: "vehicleErrorNoProviderProfile",
  PROVIDER_NOT_APPROVED: "vehicleErrorProviderNotApproved",
  DUPLICATE_REGISTRATION: "vehicleErrorDuplicateRegistration",
  VEHICLE_NOT_FOUND: "vehicleErrorNotFound",
  UNKNOWN_ERROR: "vehicleErrorUnknown",
} as const satisfies Record<VehicleActionErrorCode, string>;

export function getVehicleErrorTranslationKey(code: VehicleActionErrorCode) {
  return VEHICLE_ERROR_TRANSLATION_KEYS[code];
}
