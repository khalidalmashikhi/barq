import { MAX_DOCUMENT_BYTES } from "@/lib/provider/documents/document-constants";

// Phase 3C Slice 3B — the ONE policy for vehicle-document uploads, shared by the server (which
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

/** Decode guard: an image whose pixel count exceeds this is rejected before it is decoded. */
export const MAX_IMAGE_PIXELS = 50_000_000; // 50 MP — above any current phone sensor (48 MP)

/** Stored image: long edge and byte target. */
export const NORMALIZED_IMAGE_MAX_EDGE = 3000;
export const NORMALIZED_IMAGE_TARGET_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Tried in order until the output fits the target: (long edge, JPEG quality). */
export const NORMALIZATION_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: 3000, quality: 85 },
  { edge: 3000, quality: 75 },
  { edge: 2400, quality: 75 },
  { edge: 1800, quality: 70 },
];

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

// ISO-BMFF `ftyp` major brands of the HEIF family (Apple HEIC/HEIF stills and sequences). The
// server image stack (sharp's prebuilt libvips) ships NO HEVC decoder, so these cannot be decoded
// there and are refused explicitly — by signature, never by extension or declared MIME.
const HEIC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"]);

/** True when the leading bytes are an ISO-BMFF container whose major brand is HEIC/HEIF. */
export function isHeicSignature(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  // bytes 4..7 == "ftyp"
  if (head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70) return false;
  const brand = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!).toLowerCase();
  return HEIC_BRANDS.has(brand);
}

/** Dimensions after fitting inside a `maxEdge` square without enlarging. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
