import "server-only";
import { detectDocumentSignature } from "@/lib/provider/documents/document-signature";
import type { RegistrationExtractionFailureCode } from "./codes";
import {
  MAX_DOCUMENT_BYTES,
  MAX_REGISTRATION_PDF_PAGES,
  REGISTRATION_PARSE_TIMEOUT_MS,
  MAX_TEXT_ITEMS_PER_PAGE,
  MAX_TEXT_ITEMS_TOTAL,
  MAX_TEXT_CHARS_PER_PAGE,
  MAX_TEXT_CHARS_TOTAL,
} from "./constants";

// Phase 3C — Vehicle Registration Extraction, Slice 2 (hardened in the Slice-2 correction).
// The ONLY boundary that touches the PDF-text library (unpdf@1.8.1 → Mozilla pdf.js).
//
// Hardening: pdf.js runs with isEvalSupported:false (no JS-in-PDF), no system fonts / font-face,
// verbosity:0, and NO network. The adapter drives its OWN per-page loop (via the pdf.js document
// proxy) so it can (a) enforce early-abort item/char bounds (decompression/content-bomb
// mitigation — NOT antivirus) and (b) actually CANCEL on timeout by setting a cancel flag between
// pages AND destroying the document proxy (aborting pdf.js's pending work), not merely abandoning
// the await. A suspicious non-whitespace payload after the final %%EOF (possible polyglot) is
// rejected structurally. Every outcome is a stable safe code — never a raw exception, never bytes
// or extracted text in logs.

export type PdfTextSuccess = { ok: true; pageCount: number; text: string };
export type PdfTextFailure = { ok: false; code: RegistrationExtractionFailureCode };
export type PdfTextResult = PdfTextSuccess | PdfTextFailure;

export type PdfTextOptions = {
  maxPages?: number;
  timeoutMs?: number;
  // Resource bounds (default to the module constants); overridable so a real-parser test can
  // prove the early-abort fires on genuinely-extracted content with a tiny bound.
  maxItemsPerPage?: number;
  maxItemsTotal?: number;
  maxCharsPerPage?: number;
  maxCharsTotal?: number;
};

// Minimal structural view of the pdf.js objects we depend on (injectable for tests). We use the
// lower-level LOADING TASK (via unpdf's getResolvedPDFJS().getDocument) rather than the high-level
// getDocumentProxy, because ONLY the loading task exposes destroy() — the mechanism that actually
// aborts pdf.js's pending work on timeout (the document proxy has no destroy()).
export type PdfTextItemLike = { str?: string; hasEOL?: boolean };
export type PdfPageProxyLike = { getTextContent: () => Promise<{ items: PdfTextItemLike[] }>; cleanup?: () => void };
export type PdfDocProxyLike = { numPages: number; getPage: (n: number) => Promise<PdfPageProxyLike> };
export type PdfLoadingTaskLike = { promise: Promise<PdfDocProxyLike>; destroy: () => Promise<void> | void };
export type PdfTextDeps = {
  getDocument: (data: Uint8Array, options?: Record<string, unknown>) => Promise<PdfLoadingTaskLike>;
};

const defaultDeps: PdfTextDeps = {
  getDocument: async (data, options) => {
    const { getResolvedPDFJS } = await import("unpdf");
    const pdfjs = await getResolvedPDFJS();
    return pdfjs.getDocument({ data, ...options }) as unknown as PdfLoadingTaskLike;
  },
};

function mapException(error: unknown): RegistrationExtractionFailureCode {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return "PDF_ENCRYPTED";
  if (name === "InvalidPDFException" || name === "MissingPDFException" || name === "UnexpectedResponseException") {
    return "PDF_MALFORMED";
  }
  return "EXTRACTION_FAILED";
}

// Suspicious-trailer (polyglot) heuristic: significant non-whitespace bytes after the FINAL
// "%%EOF". Incremental-update PDFs still end with their own %%EOF, so content beyond the last one
// is abnormal. This is a deterministic structural check, NOT comprehensive polyglot/malware
// detection (documented as a separate future upload-scanning control).
const EOF_MARKER = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
function hasSuspiciousTrailer(bytes: Uint8Array): boolean {
  let idx = -1;
  for (let i = bytes.length - EOF_MARKER.length; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < EOF_MARKER.length; j++) {
      if (bytes[i + j] !== EOF_MARKER[j]) { match = false; break; }
    }
    if (match) { idx = i; break; }
  }
  if (idx < 0) return false; // no %%EOF at all — let the parser reject it as malformed
  let nonWhitespace = 0;
  for (let i = idx + EOF_MARKER.length; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09 || b === 0x0c || b === 0x00) continue;
    nonWhitespace++;
  }
  return nonWhitespace > 4; // tolerate a stray byte; a real polyglot appends a whole payload
}

export async function extractPdfText(
  bytes: ArrayBuffer,
  options: PdfTextOptions = {},
  deps: PdfTextDeps = defaultDeps,
): Promise<PdfTextResult> {
  const maxPages = options.maxPages ?? MAX_REGISTRATION_PDF_PAGES;
  const timeoutMs = options.timeoutMs ?? REGISTRATION_PARSE_TIMEOUT_MS;
  const maxItemsPerPage = options.maxItemsPerPage ?? MAX_TEXT_ITEMS_PER_PAGE;
  const maxItemsTotal = options.maxItemsTotal ?? MAX_TEXT_ITEMS_TOTAL;
  const maxCharsPerPage = options.maxCharsPerPage ?? MAX_TEXT_CHARS_PER_PAGE;
  const maxCharsTotal = options.maxCharsTotal ?? MAX_TEXT_CHARS_TOTAL;

  const head = new Uint8Array(bytes);
  if (bytes.byteLength <= 0) return { ok: false, code: "PDF_MALFORMED" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  if (detectDocumentSignature(head.slice(0, 16)) !== "pdf") return { ok: false, code: "INVALID_FILE_TYPE" };
  if (hasSuspiciousTrailer(head)) return { ok: false, code: "PDF_TRAILING_DATA" };

  // Shared state lets the timeout actually cancel the page loop AND destroy the loading task.
  const state: { cancelled: boolean; task: PdfLoadingTaskLike | null } = { cancelled: false, task: null };

  const parse = async (): Promise<PdfTextResult> => {
    const task = await deps.getDocument(new Uint8Array(bytes), {
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    state.task = task;
    if (state.cancelled) return { ok: false, code: "PARSER_TIMEOUT" };
    const pdf = await task.promise;
    if (state.cancelled) return { ok: false, code: "PARSER_TIMEOUT" };
    if (pdf.numPages > maxPages) return { ok: false, code: "PDF_PAGE_LIMIT" };

    let text = "";
    let totalItems = 0;
    let totalChars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      if (state.cancelled) return { ok: false, code: "PARSER_TIMEOUT" };
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let pageItems = 0;
      let pageChars = 0;
      for (const item of content.items) {
        if (typeof item.str !== "string") continue; // skip marked-content items
        pageItems++;
        totalItems++;
        pageChars += item.str.length;
        totalChars += item.str.length;
        if (
          pageItems > maxItemsPerPage ||
          totalItems > maxItemsTotal ||
          pageChars > maxCharsPerPage ||
          totalChars > maxCharsTotal
        ) {
          page.cleanup?.();
          return { ok: false, code: "TEXT_LIMIT_EXCEEDED" };
        }
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      page.cleanup?.();
      text += "\n";
    }
    if (text.trim().length === 0) return { ok: false, code: "NO_TEXT_LAYER" };
    return { ok: true, pageCount: pdf.numPages, text };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const destroyTask = () => {
    if (state.task) {
      try {
        const r = state.task.destroy();
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  };
  const timeout = new Promise<PdfTextResult>((resolve) => {
    timer = setTimeout(() => {
      state.cancelled = true;
      // Destroy the loading task to actually abort pdf.js's pending work (not just stop awaiting).
      destroyTask();
      resolve({ ok: false, code: "PARSER_TIMEOUT" });
    }, timeoutMs);
  });

  try {
    // A late parse rejection AFTER the timeout won is swallowed here (no unhandled rejection).
    const result = await Promise.race([parse().catch((e) => ({ ok: false as const, code: mapException(e) })), timeout]);
    // Destroy the task once on every path (success, failure, or timeout-with-late-resolution).
    destroyTask();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
