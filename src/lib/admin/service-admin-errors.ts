import "server-only";

// Service admin action error codes — Phase 2.3 (Service Foundation).
// Same stable, locale-neutral, machine-readable convention as
// provider-admin-errors.ts/category-errors.ts: shared across every
// admin-side Service action — never displayed directly. Kept separate
// from src/lib/provider/service-action-errors.ts, which covers the
// pre-existing self-service create/edit/publish/unpublish/duplicate
// flow (Phase 4.2) and has a different, provider-ownership-shaped code
// set (NO_PROVIDER_PROFILE, PROVIDER_NOT_APPROVED don't apply here —
// an admin isn't acting as a provider).

export type ServiceAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "SERVICE_NOT_FOUND"
  | "PROVIDER_NOT_FOUND"
  | "NO_ACTIVE_PRICE"
  | "INVALID_STATUS_TRANSITION"
  | "UNKNOWN_ERROR";

const SERVICE_ADMIN_ACTION_ERROR_CODES: readonly ServiceAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "SERVICE_NOT_FOUND",
  "PROVIDER_NOT_FOUND",
  "NO_ACTIVE_PRICE",
  "INVALID_STATUS_TRANSITION",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isServiceAdminActionErrorCode(value: unknown): value is ServiceAdminActionErrorCode {
  return typeof value === "string" && (SERVICE_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const SERVICE_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "serviceErrorInvalidInput",
  NO_ADMIN_PROFILE: "serviceErrorNoAdminProfile",
  SERVICE_NOT_FOUND: "serviceErrorNotFound",
  PROVIDER_NOT_FOUND: "serviceErrorProviderNotFound",
  NO_ACTIVE_PRICE: "serviceErrorNoActivePrice",
  INVALID_STATUS_TRANSITION: "serviceErrorInvalidTransition",
  UNKNOWN_ERROR: "serviceErrorUnknown",
} as const satisfies Record<ServiceAdminActionErrorCode, string>;

export function getServiceAdminErrorTranslationKey(code: ServiceAdminActionErrorCode) {
  return SERVICE_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
