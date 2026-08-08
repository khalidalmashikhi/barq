import "server-only";

// Shared provider media error codes (Media Foundation, Gap C) — reused by
// cover + portfolio upload/delete flows. Same discipline as
// provider-logo-errors.ts (the logo slice shipped first with its own,
// logo-worded copy); these are generic so cover/portfolio share one set of
// translation keys rather than duplicating per surface.

export type ProviderMediaErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "EMPTY_FILE"
  | "STORAGE_NOT_CONFIGURED"
  | "UPLOAD_FAILED"
  | "NO_PROVIDER_PROFILE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LIMIT_REACHED"
  | "UNKNOWN_ERROR";

const PROVIDER_MEDIA_ERROR_CODES: readonly ProviderMediaErrorCode[] = [
  "INVALID_INPUT",
  "UNSUPPORTED_TYPE",
  "TOO_LARGE",
  "EMPTY_FILE",
  "STORAGE_NOT_CONFIGURED",
  "UPLOAD_FAILED",
  "NO_PROVIDER_PROFILE",
  "NOT_FOUND",
  "FORBIDDEN",
  "LIMIT_REACHED",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — an incoming `?mediaError=` value is
// arbitrary client input; an unrecognized value shows no message.
export function isProviderMediaErrorCode(value: unknown): value is ProviderMediaErrorCode {
  return typeof value === "string" && (PROVIDER_MEDIA_ERROR_CODES as readonly string[]).includes(value);
}

const PROVIDER_MEDIA_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "mediaErrorInvalidInput",
  UNSUPPORTED_TYPE: "mediaErrorUnsupportedType",
  TOO_LARGE: "mediaErrorTooLarge",
  EMPTY_FILE: "mediaErrorEmptyFile",
  STORAGE_NOT_CONFIGURED: "mediaErrorStorageNotConfigured",
  UPLOAD_FAILED: "mediaErrorUploadFailed",
  NO_PROVIDER_PROFILE: "mediaErrorNoProviderProfile",
  NOT_FOUND: "mediaErrorNotFound",
  FORBIDDEN: "mediaErrorForbidden",
  LIMIT_REACHED: "mediaErrorLimitReached",
  UNKNOWN_ERROR: "mediaErrorUnknown",
} as const satisfies Record<ProviderMediaErrorCode, string>;

export function getProviderMediaErrorTranslationKey(code: ProviderMediaErrorCode) {
  return PROVIDER_MEDIA_ERROR_TRANSLATION_KEYS[code];
}

// Maps an image-validation failure (from validateImageUpload) to the code.
export function validationErrorToMediaCode(error: string): ProviderMediaErrorCode {
  if (error === "UNSUPPORTED_TYPE" || error === "TOO_LARGE" || error === "EMPTY_FILE") {
    return error;
  }
  return "INVALID_INPUT";
}
