import "server-only";

// Provider logo upload error codes (Media Foundation, Gap C). Same shape
// as provider-profile-errors.ts: stable, locale-neutral, machine-readable
// codes carried over the redirect query string — never displayed directly.

export type ProviderLogoErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "EMPTY_FILE"
  | "STORAGE_NOT_CONFIGURED"
  | "UPLOAD_FAILED"
  | "NO_PROVIDER_PROFILE"
  | "UNKNOWN_ERROR";

const PROVIDER_LOGO_ERROR_CODES: readonly ProviderLogoErrorCode[] = [
  "INVALID_INPUT",
  "UNSUPPORTED_TYPE",
  "TOO_LARGE",
  "EMPTY_FILE",
  "STORAGE_NOT_CONFIGURED",
  "UPLOAD_FAILED",
  "NO_PROVIDER_PROFILE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — an incoming `?logoError=` value is
// arbitrary client input; an unrecognized value shows no message.
export function isProviderLogoErrorCode(value: unknown): value is ProviderLogoErrorCode {
  return typeof value === "string" && (PROVIDER_LOGO_ERROR_CODES as readonly string[]).includes(value);
}

const PROVIDER_LOGO_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "logoErrorInvalidInput",
  UNSUPPORTED_TYPE: "logoErrorUnsupportedType",
  TOO_LARGE: "logoErrorTooLarge",
  EMPTY_FILE: "logoErrorEmptyFile",
  STORAGE_NOT_CONFIGURED: "logoErrorStorageNotConfigured",
  UPLOAD_FAILED: "logoErrorUploadFailed",
  NO_PROVIDER_PROFILE: "logoErrorNoProviderProfile",
  UNKNOWN_ERROR: "logoErrorUnknown",
} as const satisfies Record<ProviderLogoErrorCode, string>;

export function getProviderLogoErrorTranslationKey(code: ProviderLogoErrorCode) {
  return PROVIDER_LOGO_ERROR_TRANSLATION_KEYS[code];
}
