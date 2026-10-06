// Phase 3C — Vehicle Registration Extraction, Slice 2. Shared constants for the
// native-PDF-text extraction engine. Pure (no server-only): safe to import from
// both the pure parser and the server-only service/adapter.

/** Bumped whenever the parser's field/normalization/confidence rules change. Persisted
 *  on each extraction record so a re-run under the SAME version is idempotent and a
 *  later version can be re-processed deliberately. */
export const REGISTRATION_PARSER_VERSION = "1.0.0";

/** The only document layout this engine understands. */
export const REGISTRATION_DOCUMENT_KIND = "OMAN_VEHICLE_REGISTRATION" as const;
export type RegistrationDocumentKind = typeof REGISTRATION_DOCUMENT_KIND;

/** Tier 1 — deterministic extraction from a native PDF text layer. Always tried first. */
export const REGISTRATION_EXTRACTION_SOURCE = "NATIVE_PDF_TEXT" as const;

/** Tier 2 — the document (a photo, or a scanned/image-only PDF) was read by the configured OCR
 *  engine. An OCR value is ALWAYS a suggestion for the provider to review: it is never given HIGH
 *  confidence and never verifies anything. */
export const REGISTRATION_OCR_SOURCE = "OCR" as const;

export type RegistrationExtractionSource = typeof REGISTRATION_EXTRACTION_SOURCE | typeof REGISTRATION_OCR_SOURCE;

/** How long ONE attempt may hold a PROCESSING extraction (an OCR call in flight). Longer than the
 *  OCR timeout plus persistence, so a live attempt never loses its lease; an attempt that died
 *  stops blocking a retry after this long. */
export const REGISTRATION_OCR_LEASE_MS = 90_000;

/** Hard upper bound on one external OCR call before it is aborted (OCR_TIMEOUT, retryable). */
export const REGISTRATION_OCR_TIMEOUT_MS = 25_000;

/** Bounds on what an OCR engine may hand back per field (defence against a runaway response). */
export const MAX_OCR_CANDIDATES_PER_FIELD = 4;
export const MAX_OCR_CANDIDATE_CHARS = 120;

// ── OCR privacy / abuse gate ─────────────────────────────────────────────────────────────────────
/** Hard ceiling on EXTERNAL OCR calls per stored document (retries included). Beyond it the
 *  document goes to manual entry (OCR_ATTEMPT_LIMIT) — a provider cannot turn one upload into an
 *  unbounded stream of vendor calls. */
export const MAX_OCR_CALLS_PER_DOCUMENT = 5;
/** A reader never sends more than this (the stored document is already bounded by the 4 MiB
 *  upload ceiling and images are re-encoded to <= 2 MiB; this is the belt to that brace). */
export const MAX_OCR_INPUT_BYTES = 4 * 1024 * 1024;
/** Name of the external processor as disclosed to the provider and recorded with each consent. */
export const REGISTRATION_OCR_PROCESSOR = "anthropic";
/** The ONLY purpose a registration document may be processed for externally. */
export const REGISTRATION_OCR_PURPOSE = "VEHICLE_REGISTRATION_READING";

/** Conservative page-count ceiling — an Omani registration is 1–2 pages; anything far
 *  larger is rejected (`PDF_PAGE_LIMIT`) rather than parsed, bounding memory/time. */
export const MAX_REGISTRATION_PDF_PAGES = 8;

/** Hard upper bound on parse wall-time before returning `PARSER_TIMEOUT` (bounded work). */
export const REGISTRATION_PARSE_TIMEOUT_MS = 10_000;

// Resource-exhaustion mitigations (NOT antivirus/CDR). A legitimate Omani registration is
// tiny (dozens of text items, a few hundred characters); these ceilings are generous for real
// documents yet bound a decompression/content bomb, and the parser STOPS early when exceeded
// (returning TEXT_LIMIT_EXCEEDED) rather than materializing unbounded text.
export const MAX_TEXT_ITEMS_PER_PAGE = 5_000;
export const MAX_TEXT_ITEMS_TOTAL = 20_000;
export const MAX_TEXT_CHARS_PER_PAGE = 20_000;
export const MAX_TEXT_CHARS_TOTAL = 100_000;

/** Reuses the shared 4 MiB document ceiling (below Vercel's 4.5 MB function body limit). */
export { MAX_DOCUMENT_BYTES } from "@/lib/provider/documents/document-constants";
