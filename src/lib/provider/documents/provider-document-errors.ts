import "server-only";

// Provider document error codes — Gate 2. Stable, locale-neutral, machine-
// readable (same convention as provider-application-errors.ts / service-action-
// errors.ts): never displayed directly. The translation-key map is defined here
// for the contract; the actual 8-locale strings are added with the UX surfaces
// in Gate 3.

export type ProviderDocumentErrorCode =
  | "INVALID_INPUT"
  | "NO_PROVIDER_PROFILE"
  | "NO_ADMIN_PROFILE"
  | "STORAGE_NOT_CONFIGURED"
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "SIGNATURE_MISMATCH"
  | "DOCUMENT_NOT_FOUND"
  | "ALREADY_EXISTS"
  | "NOT_DELETABLE"
  | "REASON_REQUIRED"
  | "STALE_DOCUMENT"
  | "UNKNOWN_ERROR";

const PROVIDER_DOCUMENT_ERROR_CODES: readonly ProviderDocumentErrorCode[] = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "NO_ADMIN_PROFILE",
  "STORAGE_NOT_CONFIGURED",
  "EMPTY_FILE",
  "TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "SIGNATURE_MISMATCH",
  "DOCUMENT_NOT_FOUND",
  "ALREADY_EXISTS",
  "NOT_DELETABLE",
  "REASON_REQUIRED",
  "STALE_DOCUMENT",
  "UNKNOWN_ERROR",
];

export function isProviderDocumentErrorCode(value: unknown): value is ProviderDocumentErrorCode {
  return typeof value === "string" && (PROVIDER_DOCUMENT_ERROR_CODES as readonly string[]).includes(value);
}

const TRANSLATION_KEYS = {
  INVALID_INPUT: "documentErrorInvalidInput",
  NO_PROVIDER_PROFILE: "documentErrorNoProviderProfile",
  NO_ADMIN_PROFILE: "documentErrorNoAdminProfile",
  STORAGE_NOT_CONFIGURED: "documentErrorStorageNotConfigured",
  EMPTY_FILE: "documentErrorEmptyFile",
  TOO_LARGE: "documentErrorTooLarge",
  UNSUPPORTED_TYPE: "documentErrorUnsupportedType",
  SIGNATURE_MISMATCH: "documentErrorSignatureMismatch",
  DOCUMENT_NOT_FOUND: "documentErrorNotFound",
  ALREADY_EXISTS: "documentErrorAlreadyExists",
  NOT_DELETABLE: "documentErrorNotDeletable",
  REASON_REQUIRED: "documentErrorReasonRequired",
  STALE_DOCUMENT: "documentErrorStaleDocument",
  UNKNOWN_ERROR: "documentErrorUnknown",
} as const satisfies Record<ProviderDocumentErrorCode, string>;

export function getProviderDocumentErrorTranslationKey(code: ProviderDocumentErrorCode) {
  return TRANSLATION_KEYS[code];
}

// Shared domain result shapes. Mutations never throw for expected outcomes —
// they return a machine-readable error code (UnauthenticatedError is the one
// exception: it propagates so the transport can redirect to login).
export type ProviderDocumentActionResult = { ok: true } | { ok: false; error: ProviderDocumentErrorCode };
export type UploadProviderDocumentResult = { ok: true; documentId: string } | { ok: false; error: ProviderDocumentErrorCode };

// Transport helper: map an error code to an HTTP status for the JSON routes.
const HTTP_STATUS: Record<ProviderDocumentErrorCode, number> = {
  INVALID_INPUT: 400,
  EMPTY_FILE: 400,
  TOO_LARGE: 400,
  UNSUPPORTED_TYPE: 400,
  SIGNATURE_MISMATCH: 400,
  REASON_REQUIRED: 400,
  NO_PROVIDER_PROFILE: 403,
  NO_ADMIN_PROFILE: 403,
  DOCUMENT_NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  NOT_DELETABLE: 409,
  STALE_DOCUMENT: 409,
  STORAGE_NOT_CONFIGURED: 503,
  UNKNOWN_ERROR: 500,
};

export function providerDocumentErrorHttpStatus(code: ProviderDocumentErrorCode): number {
  return HTTP_STATUS[code];
}
