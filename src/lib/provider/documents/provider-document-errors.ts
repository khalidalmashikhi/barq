import "server-only";
import {
  isProviderDocumentErrorCode,
  getProviderDocumentErrorTranslationKey,
  type ProviderDocumentErrorCode,
} from "./provider-document-error-codes";

// Provider document error contract — Gate 2, extended in Gate 0. The stable
// codes, type guard, and translation-key map now live in the ISOMORPHIC
// ./provider-document-error-codes (so the auto-upload client can map codes to
// messages too); this server-only module re-exports them for existing callers
// and owns the transport-only concerns (HTTP status map + domain result shapes).

export {
  isProviderDocumentErrorCode,
  getProviderDocumentErrorTranslationKey,
  type ProviderDocumentErrorCode,
};

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
  APPLICATION_LOCKED: 409,
  STORAGE_NOT_CONFIGURED: 503,
  UPLOAD_FAILED: 502,
  UNKNOWN_ERROR: 500,
};

export function providerDocumentErrorHttpStatus(code: ProviderDocumentErrorCode): number {
  return HTTP_STATUS[code];
}
