// Phase 3C Slice 3A — PURE mapping of the extraction + confirmation records to a SAFE UI state
// (localized labels resolved in the component) and the supersession/staleness rule. No internal
// error codes or stack traces ever reach the UI — only these stable state strings + safe labels.

import type { RegistrationExtractionFailureCode } from "@/lib/vehicles/registration-extraction/codes";

export type ExtractionFacts = {
  status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED";
  failureCode: string | null;
  documentSha256: string;
  parserVersion: string;
} | null;

export type ConfirmationFacts = {
  status: "DRAFT" | "SUBMITTED" | "SUPERSEDED";
  boundDocumentSha256: string;
  boundParserVersion: string;
} | null;

export type ExtractionUiState =
  | "NOT_ANALYZED"
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
};

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

export function deriveReviewState(extraction: ExtractionFacts, confirmation: ConfirmationFacts): ReviewState {
  const extractionState: ExtractionUiState = !extraction ? "NOT_ANALYZED" : extraction.status;
  const failureLabelKey = extraction && extraction.status === "FAILED" ? extractionFailureLabelKey(extraction.failureCode) : null;

  const stale = isConfirmationStale(confirmation, extraction);
  let confirmationState: ConfirmationUiState;
  if (!confirmation) confirmationState = "NONE";
  else if (confirmation.status === "SUPERSEDED") confirmationState = "SUPERSEDED";
  else if (stale) confirmationState = "STALE"; // active DRAFT/SUBMITTED bound to an old extraction
  else confirmationState = confirmation.status; // DRAFT | SUBMITTED

  // Analyze/retry when there is no usable extraction yet.
  const canAnalyze = extractionState === "NOT_ANALYZED" || extractionState === "FAILED";
  // Confirm when an extraction exists (even NEEDS_REVIEW; manual entry allowed) and the claim is not
  // a locked, current SUBMITTED one. A STALE claim requires fresh review (so confirming is allowed).
  const locked = confirmationState === "SUBMITTED";
  const canConfirm = extractionState !== "NOT_ANALYZED" && extractionState !== "FAILED" && !locked;

  return { extraction: extractionState, failureLabelKey, confirmation: confirmationState, canAnalyze, canConfirm, locked };
}
