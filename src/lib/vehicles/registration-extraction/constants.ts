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

/** This slice extracts ONLY from a native PDF text layer — never OCR (Tier 2, not built). */
export const REGISTRATION_EXTRACTION_SOURCE = "NATIVE_PDF_TEXT" as const;

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
