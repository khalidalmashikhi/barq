import { detectDocumentSignature, type DocumentSignatureFormat } from "./document-signature";

// Provider verification document upload constants + validation — Gate 2 (RC1/RC2).
// Pure and isomorphic (no server-only): reusable by the web route and a future
// mobile API.

// 4 MB — intentionally BELOW Vercel's verified 4.5 MB Function request-body
// ceiling, leaving margin for multipart boundaries/headers/other form fields
// (Option 1: browser -> BARQ route handler -> private bucket). This is an MVP
// product limit, not a legal/document requirement. NOTE (separate known issue,
// deliberately NOT changed here): the public media cap MAX_IMAGE_BYTES = 5 MB
// exceeds the same 4.5 MB ceiling — tracked separately, untouched by this gate.
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

// declared MIME -> canonical format + stored file extension. Only these four
// are accepted. SVG (XSS vector), HTML, executables, archives, and any other
// type are rejected. `as const satisfies` keeps the literal types.
export const ALLOWED_DOCUMENT_MIME_TYPES = {
  "application/pdf": { format: "pdf", ext: "pdf" },
  "image/jpeg": { format: "jpeg", ext: "jpg" },
  "image/png": { format: "png", ext: "png" },
  "image/webp": { format: "webp", ext: "webp" },
} as const satisfies Record<string, { format: DocumentSignatureFormat; ext: string }>;

export type DocumentValidationErrorCode = "EMPTY_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH";

export type DocumentValidationResult =
  | { ok: true; ext: string; format: DocumentSignatureFormat; mimeType: string }
  | { ok: false; error: DocumentValidationErrorCode };

/**
 * Validates BOTH the declared MIME (allow-list) AND the actual magic bytes, and
 * that the two AGREE. Under Option 1 the server holds the bytes and runs this
 * BEFORE any storage upload, so a spoofed Content-Type, an HTML-as-PDF payload,
 * an SVG, an oversized file, or an unknown binary never reaches the bucket.
 *
 * `head` may be the full file bytes or just the leading bytes — only the
 * leading bytes are inspected for the signature.
 */
export function validateDocumentUpload(params: {
  declaredMimeType: string;
  sizeBytes: number;
  head: Uint8Array;
}): DocumentValidationResult {
  if (params.sizeBytes <= 0) return { ok: false, error: "EMPTY_FILE" };
  if (params.sizeBytes > MAX_DOCUMENT_BYTES) return { ok: false, error: "TOO_LARGE" };

  const allowed = (
    ALLOWED_DOCUMENT_MIME_TYPES as Record<string, { format: DocumentSignatureFormat; ext: string }>
  )[params.declaredMimeType];
  if (!allowed) return { ok: false, error: "UNSUPPORTED_TYPE" };

  const detected = detectDocumentSignature(params.head);
  if (detected === null || detected !== allowed.format) {
    return { ok: false, error: "SIGNATURE_MISMATCH" };
  }

  return { ok: true, ext: allowed.ext, format: allowed.format, mimeType: params.declaredMimeType };
}
