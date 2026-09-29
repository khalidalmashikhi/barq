// Phase 3C — Vehicle Registration Extraction, Slice 2. Stable, safe result codes.
// These are the ONLY things surfaced on a failure — never a raw library exception,
// never file bytes, never extracted text. Pure (no server-only).

/** Safe, stable failure codes for the PDF-text extraction adapter + service. A caller
 *  (a later provider/admin workflow) maps these to localized, non-leaking messages. */
export const REGISTRATION_EXTRACTION_FAILURE_CODES = [
  "INVALID_FILE_TYPE", // not a PDF (declared MIME / magic-byte mismatch) — images go to OCR (not built)
  "FILE_TOO_LARGE", // exceeds MAX_DOCUMENT_BYTES
  "PDF_ENCRYPTED", // password-protected / encrypted PDF
  "PDF_PAGE_LIMIT", // more pages than MAX_REGISTRATION_PDF_PAGES
  "PDF_MALFORMED", // corrupt / not a parseable PDF
  "NO_TEXT_LAYER", // valid PDF but no extractable text (scanned/image-only)
  "UNSUPPORTED_LAYOUT", // text extracted but no supported registration field recognised
  "PARSER_TIMEOUT", // parse exceeded REGISTRATION_PARSE_TIMEOUT_MS
  "EXTRACTION_FAILED", // any unexpected error (mapped, never a raw exception)
] as const;

export type RegistrationExtractionFailureCode = (typeof REGISTRATION_EXTRACTION_FAILURE_CODES)[number];

export function isRegistrationExtractionFailureCode(v: unknown): v is RegistrationExtractionFailureCode {
  return typeof v === "string" && (REGISTRATION_EXTRACTION_FAILURE_CODES as readonly string[]).includes(v);
}

/** Overall outcome of an extraction attempt (persisted as the record status). */
export const REGISTRATION_EXTRACTION_STATUSES = ["EXTRACTED", "NEEDS_REVIEW", "FAILED"] as const;
export type RegistrationExtractionStatus = (typeof REGISTRATION_EXTRACTION_STATUSES)[number];

/** Per-field, rule-based (NOT ML) confidence. */
export const REGISTRATION_FIELD_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type RegistrationFieldConfidence = (typeof REGISTRATION_FIELD_CONFIDENCES)[number];
