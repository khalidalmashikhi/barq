// VEHICLE-LC3 — stable error codes for the Admin vehicle verification-review
// workflow (document approve/reject + overall approve/reject/request-changes).
// Mirrors provider-admin-errors.ts: callers map a code to an `admin`-namespace
// message; raw Prisma/storage errors are never surfaced.

export const VEHICLE_ADMIN_ERROR_CODES = [
  "NO_ADMIN_PROFILE",
  "INVALID_INPUT",
  "REASON_REQUIRED",
  // Vehicle asset not found (admin is globally authorized, so this is a genuine
  // missing row, never an ownership signal).
  "VEHICLE_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  // The reviewed document was replaced/re-reviewed since the admin loaded it.
  "STALE_DOCUMENT",
  // The vehicle is not in SUBMITTED state (a decision only applies to SUBMITTED).
  "NOT_SUBMITTED",
  // Approval attempted while approval blockers remain (missing/unapproved/expired
  // required documents, invalid vehicle data, or wrong verification state).
  "NOT_READY",
  "UNKNOWN_ERROR",
] as const;

export type VehicleAdminActionErrorCode = (typeof VEHICLE_ADMIN_ERROR_CODES)[number];

export type VehicleAdminActionResult = { ok: true } | { ok: false; error: VehicleAdminActionErrorCode };

export function isVehicleAdminActionErrorCode(value: unknown): value is VehicleAdminActionErrorCode {
  return typeof value === "string" && (VEHICLE_ADMIN_ERROR_CODES as readonly string[]).includes(value);
}

const TRANSLATION_KEYS = {
  NO_ADMIN_PROFILE: "vehicleReviewErrorNoAdmin",
  INVALID_INPUT: "vehicleReviewErrorInvalidInput",
  REASON_REQUIRED: "vehicleReviewErrorReasonRequired",
  VEHICLE_NOT_FOUND: "vehicleReviewErrorVehicleNotFound",
  DOCUMENT_NOT_FOUND: "vehicleReviewErrorDocumentNotFound",
  STALE_DOCUMENT: "vehicleReviewErrorStaleDocument",
  NOT_SUBMITTED: "vehicleReviewErrorNotSubmitted",
  NOT_READY: "vehicleReviewErrorNotReady",
  UNKNOWN_ERROR: "vehicleReviewErrorUnknown",
} as const satisfies Record<VehicleAdminActionErrorCode, string>;

export function getVehicleAdminErrorTranslationKey(code: VehicleAdminActionErrorCode) {
  return TRANSLATION_KEYS[code];
}
