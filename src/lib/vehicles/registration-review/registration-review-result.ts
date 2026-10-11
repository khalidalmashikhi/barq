// Phase 3C Slice 3A — stable coded results for the provider registration-review mutations, mapped
// to localized provider-namespace message keys. Non-enumerating: all not-found variants collapse
// to one generic key. No raw error ever reaches the client.

import type { ConfirmationFieldError } from "./confirmation-input";

export type RegistrationReviewCode =
  | "VEHICLE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "EXTRACTION_NOT_READY"
  | "LOCKED"
  | "SUPERSEDED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "STORAGE_NOT_CONFIGURED"
  | "EXTRACTION_FAILED"
  // OCR consent decisions (Phase 3C privacy gate)
  | "OCR_NOT_AVAILABLE"
  | "OWNER_AUTHORIZATION_REQUIRED"
  // Recovery of a stale / incomplete reading (2026-10-09)
  | "OCR_CONSENT_REQUIRED"
  | "OCR_RATE_LIMITED"
  | "OCR_ATTEMPT_LIMIT"
  | "RESULT_STALE"
  | "COMPLETION_FAILED"
  | "COMPLETION_NOT_AVAILABLE"
  | "UNAUTHENTICATED"
  | "UNKNOWN_ERROR";

export type RegistrationReviewResult =
  | { ok: true }
  | { ok: false; code: RegistrationReviewCode; fieldErrors?: ConfirmationFieldError[] };

export type RegistrationAnalysisResult =
  | { ok: true; status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED" | "PROCESSING" | "AWAITING_CONSENT"; failureLabelKey: string | null }
  | { ok: false; code: RegistrationReviewCode };

const MESSAGE_KEY: Record<RegistrationReviewCode, string> = {
  VEHICLE_NOT_FOUND: "vehicleRegReviewErrNotFound",
  DOCUMENT_NOT_FOUND: "vehicleRegReviewErrNotFound", // non-enumerating: same as vehicle-not-found
  EXTRACTION_NOT_READY: "vehicleRegReviewErrNotReady",
  LOCKED: "vehicleRegReviewErrLocked",
  SUPERSEDED: "vehicleRegReviewErrSuperseded",
  INVALID_INPUT: "vehicleRegReviewErrInvalid",
  CONFLICT: "vehicleRegReviewErrConflict",
  STORAGE_NOT_CONFIGURED: "vehicleRegReviewErrStorage",
  EXTRACTION_FAILED: "vehicleRegReviewErrExtraction",
  OCR_NOT_AVAILABLE: "vehicleRegOcrNotAvailable",
  OWNER_AUTHORIZATION_REQUIRED: "vehicleRegConsentOwnerRequired",
  OCR_CONSENT_REQUIRED: "vehicleRegCompletionConsentRequired",
  OCR_RATE_LIMITED: "vehicleRegExtractFailOcrRateLimited",
  OCR_ATTEMPT_LIMIT: "vehicleRegExtractFailOcrAttemptLimit",
  RESULT_STALE: "vehicleRegRecoveryStaleError",
  COMPLETION_FAILED: "vehicleRegCompletionFailed",
  COMPLETION_NOT_AVAILABLE: "vehicleRegCompletionNotAvailable",
  UNAUTHENTICATED: "vehicleRegReviewErrAuth",
  UNKNOWN_ERROR: "vehicleRegReviewErrUnknown",
};

export function registrationReviewMessageKey(code: RegistrationReviewCode): string {
  return MESSAGE_KEY[code];
}
