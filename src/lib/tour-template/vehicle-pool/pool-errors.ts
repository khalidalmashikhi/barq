// TOUR-VEHICLE-1 — stable, locale-neutral error codes for the tour-service vehicle-pool
// domain operations (add / remove). Mirrors service-action-errors.ts + vehicle-admin-
// errors.ts: machine-readable codes, never surfaced raw; rich blocker DATA stays internal
// (getVehicleAssignmentBlockers) while the external contract stays concise. Kept in the
// "provider" translation namespace like the other provider-facing service errors.
//
// Uniform outcomes (no enumeration): a foreign OR missing service is SERVICE_NOT_FOUND;
// a foreign OR missing vehicle is VEHICLE_NOT_FOUND — a provider can never probe another
// provider's services or vehicles. Adding an already-pooled vehicle is idempotent SUCCESS
// (no ALREADY_ASSIGNED error), and removing an absent row is idempotent success too.

export const TOUR_VEHICLE_POOL_ERROR_CODES = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "PROVIDER_NOT_APPROVED",
  // Foreign/missing service (uniform — never an ownership signal).
  "SERVICE_NOT_FOUND",
  // The service is not a TOUR context that can hold a vehicle pool: it has no valid
  // smart-tour guidingContent, OR its package forbids a vehicle entirely (GUIDE_ONLY).
  "TOUR_SERVICE_NOT_ELIGIBLE",
  // Foreign/missing vehicle (uniform — never an ownership signal).
  "VEHICLE_NOT_FOUND",
  // The vehicle exists and is owned, but is not currently assignable to this package
  // (not ACTIVE/APPROVED, a required doc missing/unapproved/expired, not trusted-4x4 for
  // a 4x4 package, or insufficient guest capacity for the declared maxGuests).
  "VEHICLE_NOT_ELIGIBLE",
  "UNKNOWN_ERROR",
] as const;

export type TourVehiclePoolErrorCode = (typeof TOUR_VEHICLE_POOL_ERROR_CODES)[number];

export type TourVehiclePoolResult = { ok: true } | { ok: false; error: TourVehiclePoolErrorCode };

export function isTourVehiclePoolErrorCode(value: unknown): value is TourVehiclePoolErrorCode {
  return typeof value === "string" && (TOUR_VEHICLE_POOL_ERROR_CODES as readonly string[]).includes(value);
}

const TRANSLATION_KEYS = {
  INVALID_INPUT: "tourVehiclePoolErrorInvalidInput",
  NO_PROVIDER_PROFILE: "tourVehiclePoolErrorNoProviderProfile",
  PROVIDER_NOT_APPROVED: "tourVehiclePoolErrorProviderNotApproved",
  SERVICE_NOT_FOUND: "tourVehiclePoolErrorServiceNotFound",
  TOUR_SERVICE_NOT_ELIGIBLE: "tourVehiclePoolErrorServiceNotEligible",
  VEHICLE_NOT_FOUND: "tourVehiclePoolErrorVehicleNotFound",
  VEHICLE_NOT_ELIGIBLE: "tourVehiclePoolErrorVehicleNotEligible",
  UNKNOWN_ERROR: "tourVehiclePoolErrorUnknown",
} as const satisfies Record<TourVehiclePoolErrorCode, string>;

export function getTourVehiclePoolErrorTranslationKey(code: TourVehiclePoolErrorCode) {
  return TRANSLATION_KEYS[code];
}
