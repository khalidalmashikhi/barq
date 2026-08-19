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
