// VEHICLE-LC2 — stable domain error codes for provider asset-document + vehicle
// verification mutations. Callers map these to localized provider-namespace
// messages; raw Prisma/storage errors are never surfaced. The file-validation
// codes (EMPTY_FILE/TOO_LARGE/UNSUPPORTED_TYPE/SIGNATURE_MISMATCH) match the
// shared validateDocumentUpload() result so the same magic-byte/MIME/size checks
// apply as for provider documents.

export const ASSET_DOCUMENT_ERROR_CODES = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "PROVIDER_NOT_APPROVED",
  // Vehicle/asset not found OR not owned by the caller — one code (never enumerable).
  "VEHICLE_NOT_FOUND",
  // Document not found OR not on a vehicle the caller owns — one code.
  "DOCUMENT_NOT_FOUND",
  // A document of this type already exists for the vehicle (use Replace).
  "ALREADY_EXISTS",
  // Verification is not in an editable state (DRAFT/CHANGES_REQUESTED).
  "LOCKED",
  "STORAGE_NOT_CONFIGURED",
  "UPLOAD_FAILED",
  "EMPTY_FILE",
  "TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "SIGNATURE_MISMATCH",
  // Submission readiness failed (required docs missing/rejected).
  "NOT_READY",
  // Verification is not in a submittable state (e.g. already SUBMITTED/APPROVED).
  "INVALID_STATE",
  "UNKNOWN_ERROR",
] as const;

export type AssetDocumentErrorCode = (typeof ASSET_DOCUMENT_ERROR_CODES)[number];

export function isAssetDocumentErrorCode(value: unknown): value is AssetDocumentErrorCode {
  return typeof value === "string" && (ASSET_DOCUMENT_ERROR_CODES as readonly string[]).includes(value);
}

// Provider-namespace translation keys for surfacing an error on the Web UI.
const ASSET_DOCUMENT_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "vehicleDocErrorInvalidInput",
  NO_PROVIDER_PROFILE: "vehicleErrorNoProviderProfile",
  PROVIDER_NOT_APPROVED: "vehicleErrorProviderNotApproved",
  VEHICLE_NOT_FOUND: "vehicleErrorNotFound",
  DOCUMENT_NOT_FOUND: "vehicleDocErrorNotFound",
  ALREADY_EXISTS: "vehicleDocErrorAlreadyExists",
  LOCKED: "vehicleDocErrorLocked",
  STORAGE_NOT_CONFIGURED: "vehicleDocErrorStorage",
  UPLOAD_FAILED: "vehicleDocErrorUploadFailed",
  EMPTY_FILE: "vehicleDocErrorEmptyFile",
  TOO_LARGE: "vehicleDocErrorTooLarge",
  UNSUPPORTED_TYPE: "vehicleDocErrorUnsupportedType",
  SIGNATURE_MISMATCH: "vehicleDocErrorSignatureMismatch",
  NOT_READY: "vehicleVerifyErrorNotReady",
  INVALID_STATE: "vehicleVerifyErrorInvalidState",
  UNKNOWN_ERROR: "vehicleErrorUnknown",
} as const satisfies Record<AssetDocumentErrorCode, string>;

export function getAssetDocumentErrorTranslationKey(code: AssetDocumentErrorCode) {
  return ASSET_DOCUMENT_ERROR_TRANSLATION_KEYS[code];
}
