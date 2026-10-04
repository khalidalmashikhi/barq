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
  "PARSER_TIMEOUT", // parse exceeded REGISTRATION_PARSE_TIMEOUT_MS (parser work cancelled/destroyed)
  "TEXT_LIMIT_EXCEEDED", // extracted text item/char bound exceeded (resource-exhaustion mitigation)
  "PDF_TRAILING_DATA", // suspicious non-whitespace payload after the final %%EOF (possible polyglot)
  "EXTRACTION_FAILED", // any unexpected error (mapped, never a raw exception)
  // ---- OCR (photos and scanned PDFs). Every one leaves the document stored and the provider able
  // ---- to retry or enter the details manually.
  "OCR_NOT_CONFIGURED", // no OCR engine is configured in this environment (fail closed)
  "OCR_TIMEOUT", // the OCR call exceeded its time bound and was aborted (retryable)
  "OCR_PROVIDER_ERROR", // the OCR engine was unreachable or answered with an error (retryable)
  "OCR_MALFORMED_RESPONSE", // the OCR engine's answer did not match the expected shape (never persisted)
  "OCR_UNREADABLE", // the engine answered, but no registration field could be read from the document
] as const;

export type RegistrationExtractionFailureCode = (typeof REGISTRATION_EXTRACTION_FAILURE_CODES)[number];

export function isRegistrationExtractionFailureCode(v: unknown): v is RegistrationExtractionFailureCode {
  return typeof v === "string" && (REGISTRATION_EXTRACTION_FAILURE_CODES as readonly string[]).includes(v);
}

/** Overall outcome of an extraction attempt (persisted as the record status). */
export const REGISTRATION_EXTRACTION_STATUSES = ["EXTRACTED", "NEEDS_REVIEW", "FAILED"] as const;
export type RegistrationExtractionStatus = (typeof REGISTRATION_EXTRACTION_STATUSES)[number];

/** The persisted record status: a final outcome, or PROCESSING while one attempt holds the lease
 *  (an OCR call may be in flight). PROCESSING is never returned by the pure parser. */
export const REGISTRATION_RECORD_STATUSES = [...REGISTRATION_EXTRACTION_STATUSES, "PROCESSING"] as const;
export type RegistrationRecordStatus = (typeof REGISTRATION_RECORD_STATUSES)[number];

/** Per-field, rule-based (NOT ML) confidence. */
export const REGISTRATION_FIELD_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type RegistrationFieldConfidence = (typeof REGISTRATION_FIELD_CONFIDENCES)[number];
