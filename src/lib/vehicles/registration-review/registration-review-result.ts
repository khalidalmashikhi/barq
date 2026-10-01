// Phase 3C Slice 3A — stable coded results for the provider registration-review mutations, mapped
// to localized provider-namespace message keys. Non-enumerating: all not-found variants collapse
// to one generic key. No raw error ever reaches the client.

import type { ConfirmationFieldError } from "./confirmation-input";

export type RegistrationReviewCode =
  | "VEHICLE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "EXTRACTION_NOT_READY"
  | "LOCKED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "STORAGE_NOT_CONFIGURED"
  | "EXTRACTION_FAILED"
  | "UNAUTHENTICATED"
  | "UNKNOWN_ERROR";

export type RegistrationReviewResult =
  | { ok: true }
  | { ok: false; code: RegistrationReviewCode; fieldErrors?: ConfirmationFieldError[] };

export type RegistrationAnalysisResult =
  | { ok: true; status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED"; failureLabelKey: string | null }
  | { ok: false; code: RegistrationReviewCode };

const MESSAGE_KEY: Record<RegistrationReviewCode, string> = {
  VEHICLE_NOT_FOUND: "vehicleRegReviewErrNotFound",
  DOCUMENT_NOT_FOUND: "vehicleRegReviewErrNotFound", // non-enumerating: same as vehicle-not-found
  EXTRACTION_NOT_READY: "vehicleRegReviewErrNotReady",
  LOCKED: "vehicleRegReviewErrLocked",
  INVALID_INPUT: "vehicleRegReviewErrInvalid",
  CONFLICT: "vehicleRegReviewErrConflict",
  STORAGE_NOT_CONFIGURED: "vehicleRegReviewErrStorage",
  EXTRACTION_FAILED: "vehicleRegReviewErrExtraction",
  UNAUTHENTICATED: "vehicleRegReviewErrAuth",
  UNKNOWN_ERROR: "vehicleRegReviewErrUnknown",
};

export function registrationReviewMessageKey(code: RegistrationReviewCode): string {
  return MESSAGE_KEY[code];
}
