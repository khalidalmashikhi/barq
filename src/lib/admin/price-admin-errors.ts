import "server-only";

// Price admin action error codes — Phase 2.5 (Pricing Foundation). Same
// stable, locale-neutral, machine-readable convention as
// service-admin-errors.ts/provider-admin-errors.ts: shared across every
// admin-side Price action — never displayed directly.

export type PriceAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "SERVICE_NOT_FOUND"
  | "PRICE_NOT_FOUND"
  | "PRICE_ALREADY_ACTIVE"
  | "NO_ACTIVE_PRICE"
  | "UNKNOWN_ERROR";

const PRICE_ADMIN_ACTION_ERROR_CODES: readonly PriceAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "SERVICE_NOT_FOUND",
  "PRICE_NOT_FOUND",
  "PRICE_ALREADY_ACTIVE",
  "NO_ACTIVE_PRICE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isPriceAdminActionErrorCode(value: unknown): value is PriceAdminActionErrorCode {
  return typeof value === "string" && (PRICE_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const PRICE_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "priceErrorInvalidInput",
  NO_ADMIN_PROFILE: "priceErrorNoAdminProfile",
  SERVICE_NOT_FOUND: "priceErrorServiceNotFound",
  PRICE_NOT_FOUND: "priceErrorNotFound",
  PRICE_ALREADY_ACTIVE: "priceErrorAlreadyActive",
  NO_ACTIVE_PRICE: "priceErrorNoActivePrice",
  UNKNOWN_ERROR: "priceErrorUnknown",
} as const satisfies Record<PriceAdminActionErrorCode, string>;

export function getPriceAdminErrorTranslationKey(code: PriceAdminActionErrorCode) {
  return PRICE_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
