import "server-only";
import { detectDocumentSignature } from "@/lib/provider/documents/document-signature";
import type { RegistrationExtractionFailureCode } from "./codes";
import { MAX_DOCUMENT_BYTES, MAX_REGISTRATION_PDF_PAGES, REGISTRATION_PARSE_TIMEOUT_MS } from "./constants";

// Phase 3C — Vehicle Registration Extraction, Slice 2. The ONLY boundary that touches the
// PDF-text library (unpdf@1.8.1, a serverless build of Mozilla pdf.js). Everything about
// parsing/normalization above this file is library-agnostic and pure.
//
// Hardening: pdf.js is configured with isEvalSupported:false (no JS-in-PDF execution),
// useSystemFonts:false + disableFontFace:true (no font side effects), and unpdf performs
// NO network fetch — nothing leaves the server. The function NEVER logs bytes or extracted
// text, and NEVER surfaces a raw library exception: every outcome is a stable safe code.

export type PdfTextSuccess = { ok: true; pageCount: number; text: string };
export type PdfTextFailure = { ok: false; code: RegistrationExtractionFailureCode };
export type PdfTextResult = PdfTextSuccess | PdfTextFailure;

export type PdfTextOptions = { maxPages?: number; timeoutMs?: number };

// Injectable seam so tests can drive the encrypted/timeout/malformed paths deterministically
// without crafting real cryptographic PDFs. The real deps lazy-import unpdf (server-only, and
// keeps the ~2 MB library out of any module graph that doesn't parse a PDF).
export type PdfTextDeps = {
  getDocumentProxy: (data: Uint8Array, options?: Record<string, unknown>) => Promise<{ numPages: number }>;
  extractText: (pdf: unknown, options: { mergePages: true }) => Promise<{ totalPages: number; text: string }>;
};

const defaultDeps: PdfTextDeps = {
  getDocumentProxy: async (data, options) => {
    const { getDocumentProxy } = await import("unpdf");
    return getDocumentProxy(data, options) as unknown as Promise<{ numPages: number }>;
  },
  extractText: async (pdf, options) => {
    const { extractText } = await import("unpdf");
    return extractText(pdf as never, options) as unknown as Promise<{ totalPages: number; text: string }>;
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

export async function extractPdfText(
  bytes: ArrayBuffer,
  options: PdfTextOptions = {},
  deps: PdfTextDeps = defaultDeps,
): Promise<PdfTextResult> {
  const maxPages = options.maxPages ?? MAX_REGISTRATION_PDF_PAGES;
  const timeoutMs = options.timeoutMs ?? REGISTRATION_PARSE_TIMEOUT_MS;

  if (bytes.byteLength <= 0) return { ok: false, code: "PDF_MALFORMED" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  // Content-based type gate (never trust a declared MIME): only a real PDF magic number.
  if (detectDocumentSignature(new Uint8Array(bytes.slice(0, 16))) !== "pdf") {
    return { ok: false, code: "INVALID_FILE_TYPE" };
  }

  const parse = async (): Promise<PdfTextResult> => {
    try {
      const pdf = await deps.getDocumentProxy(new Uint8Array(bytes), {
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        // pdf.js VerbosityLevel.ERRORS — silence info/warn chatter (no bytes/text ever logged).
        verbosity: 0,
      });
      if (pdf.numPages > maxPages) return { ok: false, code: "PDF_PAGE_LIMIT" };
      const { text } = await deps.extractText(pdf, { mergePages: true });
      if (!text || text.trim().length === 0) return { ok: false, code: "NO_TEXT_LAYER" };
      return { ok: true, pageCount: pdf.numPages, text };
    } catch (error) {
      return { ok: false, code: mapException(error) };
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PdfTextResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, code: "PARSER_TIMEOUT" }), timeoutMs);
  });
  try {
    return await Promise.race([parse(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
