import { MAX_DOCUMENT_BYTES } from "@/lib/provider/documents/document-constants";

// Phase 3C Slice 3B — the upload policy for VEHICLE documents (AssetDocument) only, shared by the server (which
// enforces it) and the upload form (which pre-processes to meet it). Pure and isomorphic: no
// server-only, no DOM.
//
// TWO LIMITS, both real:
//
//   1. ABSOLUTE UPLOAD CEILING — what the server will accept in a request. It is bounded by the
//      platform, not chosen freely: a Vercel Function rejects request bodies over ~4.5 MB, so the
//      ceiling stays at the existing 4 MiB (margin for multipart framing). A larger "limit" here
//      would be a lie — the request would die before reaching our code.
//
//   2. NORMALIZED-DOCUMENT TARGET — what is actually stored for an image: a re-encoded JPEG whose
//      long edge is at most NORMALIZED_IMAGE_MAX_EDGE and whose size is at most
//      NORMALIZED_IMAGE_TARGET_BYTES. 3000 px comfortably preserves the small print of a
//      registration card for manual review and later OCR.
//
// Ordinary phone photos (often 3–12 MB, 12–48 MP) are larger than the ceiling, so the upload form
// downsizes them IN THE BROWSER before sending; the server then validates and normalizes whatever
// arrives and never trusts that the browser did anything.

/** Absolute request ceiling (platform-bound). */
export const MAX_UPLOAD_BYTES = MAX_DOCUMENT_BYTES; // 4 MiB

// The image-safety limits themselves are DOCUMENT-NEUTRAL and live in src/lib/file-safety; they are
// re-exported here because the vehicle upload form and its server policy use them together.
export { MAX_IMAGE_PIXELS, NORMALIZED_IMAGE_MAX_EDGE, NORMALIZED_IMAGE_TARGET_BYTES, NORMALIZATION_STEPS, isHeicSignature, fitWithin } from "@/lib/file-safety/image-safety-policy";

/** Browser side: the largest original photo we will even try to downsize on the device. */
export const CLIENT_MAX_SOURCE_BYTES = 30 * 1024 * 1024; // 30 MiB
/** Browser side: an image at or under this is sent as-is; a larger one is downsized first. */
export const CLIENT_UPLOAD_TARGET_BYTES = Math.floor(3.5 * 1024 * 1024); // 3.5 MiB, below the ceiling
/** Browser side downsizing attempts: (long edge, JPEG quality 0–1). */
export const CLIENT_DOWNSIZE_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: 3000, quality: 0.85 },
  { edge: 2400, quality: 0.8 },
  { edge: 1800, quality: 0.75 },
];
