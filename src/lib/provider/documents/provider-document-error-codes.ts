// Provider document error codes — ISOMORPHIC core (Gate 0 split). Stable,
// locale-neutral, machine-readable codes + their translation-key map and type
// guard. Deliberately NOT server-only: the polished auto-upload client component
// maps a returned error code to a localized message too, so this half must be
// importable from a "use client" module. The server-only transport concerns
// (HTTP status map, domain result shapes) stay in provider-document-errors.ts,
// which re-exports everything here so existing server imports are unchanged.

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
  // Gate 1A server invariant: document mutation (upload/replace/delete) is allowed
  // ONLY while the application is a DRAFT. Once submitted (UNDER_REVIEW), decided
  // (APPROVED/REJECTED), or for a legacy APPLIED row, the server rejects mutation
  // with this code — NOT just the UI. requireProvider() proves ownership/active
  // status but NOT the DRAFT lifecycle stage, so this is enforced separately.
  | "APPLICATION_LOCKED"
  // The private-bucket write itself threw (storage reachable-but-failed, e.g. a
  // missing/misconfigured bucket). Split OUT of UNKNOWN_ERROR (Gate 0) so the
  // provider gets an actionable "try again" message and the operator/telemetry
  // can tell a storage failure from a genuine internal one. Same convention as
  // the media surface's UPLOAD_FAILED. A DB-write failure stays UNKNOWN_ERROR.
  | "UPLOAD_FAILED"
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
  "APPLICATION_LOCKED",
  "UPLOAD_FAILED",
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
  APPLICATION_LOCKED: "documentErrorApplicationLocked",
  UPLOAD_FAILED: "documentErrorUploadFailed",
  UNKNOWN_ERROR: "documentErrorUnknown",
} as const satisfies Record<ProviderDocumentErrorCode, string>;

export function getProviderDocumentErrorTranslationKey(code: ProviderDocumentErrorCode) {
  return TRANSLATION_KEYS[code];
}
