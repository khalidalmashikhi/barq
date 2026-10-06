// Phase 3C Slice 3A — PURE mapping of the extraction + confirmation records to a SAFE UI state
// (localized labels resolved in the component) and the supersession/staleness rule. No internal
// error codes or stack traces ever reach the UI — only these stable state strings + safe labels.

import type { RegistrationExtractionFailureCode, RegistrationRecordStatus } from "@/lib/vehicles/registration-extraction/codes";
import { isExtractionInProgress } from "@/lib/vehicles/registration-extraction/processing-lease";

export type ExtractionFacts = {
  status: RegistrationRecordStatus;
  failureCode: string | null;
  documentSha256: string;
  parserVersion: string;
  /** Lease of the attempt reading the document (only meaningful while status is PROCESSING). */
  processingExpiresAt?: Date | null;
} | null;

export type ConfirmationFacts = {
  status: "DRAFT" | "SUBMITTED" | "SUPERSEDED";
  boundDocumentSha256: string;
  boundParserVersion: string;
} | null;

export type ExtractionUiState =
  | "NOT_ANALYZED"
  /** The document is being read right now (an OCR call is in flight). Never a final state. */
  | "PROCESSING"
  /** A photo/scan that COULD be read automatically, but the provider has not decided whether it may
   *  be sent for that (or declined). Nothing was sent. Manual entry is open; no "retry" is offered —
   *  the choice is. Only while automatic reading is available here; otherwise it is plain FAILED. */
  | "AWAITING_CONSENT"
  | "EXTRACTED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type ConfirmationUiState = "NONE" | "DRAFT" | "SUBMITTED" | "STALE" | "SUPERSEDED";

// Safe localized label keys (provider namespace) for each extraction failure code — never the code.
export const EXTRACTION_FAILURE_LABEL_KEY: Record<RegistrationExtractionFailureCode, string> = {
  INVALID_FILE_TYPE: "vehicleRegExtractFailInvalidType",
  FILE_TOO_LARGE: "vehicleRegExtractFailTooLarge",
  PDF_ENCRYPTED: "vehicleRegExtractFailEncrypted",
  PDF_PAGE_LIMIT: "vehicleRegExtractFailTooManyPages",
  PDF_MALFORMED: "vehicleRegExtractFailMalformed",
  NO_TEXT_LAYER: "vehicleRegExtractFailScanned",
  UNSUPPORTED_LAYOUT: "vehicleRegExtractFailUnsupported",
  PARSER_TIMEOUT: "vehicleRegExtractFailTimeout",
  TEXT_LIMIT_EXCEEDED: "vehicleRegExtractFailContentLimit",
  PDF_TRAILING_DATA: "vehicleRegExtractFailUnsupported",
  EXTRACTION_FAILED: "vehicleRegExtractFailGeneric",
  // OCR outcomes — each keeps the document and offers retry + manual entry.
  OCR_NOT_CONFIGURED: "vehicleRegExtractFailOcrUnavailable",
  OCR_TIMEOUT: "vehicleRegExtractFailOcrTimeout",
  OCR_PROVIDER_ERROR: "vehicleRegExtractFailOcrUnavailable",
  OCR_MALFORMED_RESPONSE: "vehicleRegExtractFailGeneric",
  OCR_UNREADABLE: "vehicleRegExtractFailOcrUnreadable",
  // OCR privacy / abuse gate. CONSENT_REQUIRED is normally shown as the choice (AWAITING_CONSENT),
  // not as a failure; it only reads as "unavailable" when automatic reading was switched off since.
  OCR_CONSENT_REQUIRED: "vehicleRegExtractFailOcrUnavailable",
  OCR_RATE_LIMITED: "vehicleRegExtractFailOcrRateLimited",
  OCR_ATTEMPT_LIMIT: "vehicleRegExtractFailOcrAttemptLimit",
  OCR_GEO_MISMATCH: "vehicleRegExtractFailOcrUnavailable",
  OCR_INPUT_TOO_LARGE: "vehicleRegExtractFailTooLarge",
};

export const OCR_CONSENT_REQUIRED_CODE = "OCR_CONSENT_REQUIRED";

export function extractionFailureLabelKey(code: string | null): string {
  if (code && code in EXTRACTION_FAILURE_LABEL_KEY) {
    return EXTRACTION_FAILURE_LABEL_KEY[code as RegistrationExtractionFailureCode];
  }
  return "vehicleRegExtractFailGeneric";
}

/** A confirmation is STALE when it is bound to a different document hash / parser version than the
 *  current extraction (the document was replaced or the parser changed). */
export function isConfirmationStale(confirmation: ConfirmationFacts, extraction: ExtractionFacts): boolean {
  if (!confirmation || !extraction) return false;
  return (
    confirmation.boundDocumentSha256 !== extraction.documentSha256 ||
    confirmation.boundParserVersion !== extraction.parserVersion
  );
}

export type ReviewState = {
  extraction: ExtractionUiState;
  /** Present only when extraction is FAILED — a safe localized label key, never the raw code. */
  failureLabelKey: string | null;
  confirmation: ConfirmationUiState;
  /** The provider may analyze/retry (no extraction yet, or a failed one). */
  canAnalyze: boolean;
  /** The provider may edit/confirm fields (extraction present and the active claim is editable). */
  canConfirm: boolean;
  /** The active claim is locked (SUBMITTED and not stale). */
  locked: boolean;
};

export type DeriveReviewStateOptions = {
  /** Whether automatic reading of photos/scans is available in this environment (default: true).
   *  Decides whether a consent-pending document is shown as a CHOICE or as plain "unavailable". */
  ocrAvailable?: boolean;
};

export function deriveReviewState(extraction: ExtractionFacts, confirmation: ConfirmationFacts, now: Date = new Date(), options: DeriveReviewStateOptions = {}): ReviewState {
  const ocrAvailable = options.ocrAvailable !== false;
  // PROCESSING is "being read" only while its lease is live. An expired lease means the attempt
  // died: it is shown as a retryable failure (and manual entry is allowed), never as a spinner.
  const reading = !!extraction && isExtractionInProgress({ status: extraction.status, processingExpiresAt: extraction.processingExpiresAt ?? null }, now);
  const abandoned = !!extraction && extraction.status === "PROCESSING" && !reading;
  const awaitingConsent = !!extraction && extraction.status === "FAILED" && extraction.failureCode === OCR_CONSENT_REQUIRED_CODE && ocrAvailable;
  const extractionState: ExtractionUiState = !extraction
    ? "NOT_ANALYZED"
    : reading
      ? "PROCESSING"
      : awaitingConsent
        ? "AWAITING_CONSENT"
        : extraction.status === "PROCESSING"
          ? "FAILED"
          : extraction.status;
  const failureLabelKey = abandoned
    ? extractionFailureLabelKey("OCR_TIMEOUT")
    : extraction && extraction.status === "FAILED" && !awaitingConsent
      ? extractionFailureLabelKey(extraction.failureCode)
      : null;

  const stale = isConfirmationStale(confirmation, extraction);
  let confirmationState: ConfirmationUiState;
  if (!confirmation) confirmationState = "NONE";
  else if (confirmation.status === "SUPERSEDED") confirmationState = "SUPERSEDED";
  else if (stale) confirmationState = "STALE"; // active DRAFT/SUBMITTED bound to an old extraction
  else confirmationState = confirmation.status; // DRAFT | SUBMITTED

  // Analyze/retry when there is no usable extraction yet. While the provider's CHOICE is pending
  // there is nothing to retry — the choice itself starts (or forgoes) the reading.
  const canAnalyze = extractionState === "NOT_ANALYZED" || extractionState === "FAILED";
  // Confirm whenever an extraction ROW exists — EXTRACTED/NEEDS_REVIEW (review suggestions) OR FAILED
  // (scanned/unreadable → the provider enters every field MANUALLY, the document still required for
  // admin verification) OR AWAITING_CONSENT (manual entry is always open). Only NOT_ANALYZED (no row
  // yet) and a locked current SUBMITTED claim block it; a STALE claim requires fresh review (so
  // confirming is allowed). FAILED also keeps Retry. While the document is being read the provider
  // waits (the suggestions are about to arrive) — bounded by the lease; after that the form opens.
  const locked = confirmationState === "SUBMITTED";
  const canConfirm = extractionState !== "NOT_ANALYZED" && extractionState !== "PROCESSING" && !locked;

  return { extraction: extractionState, failureLabelKey, confirmation: confirmationState, canAnalyze, canConfirm, locked };
}
