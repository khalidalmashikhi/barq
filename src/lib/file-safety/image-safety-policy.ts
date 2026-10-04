// DOCUMENT-NEUTRAL image-safety limits and helpers. Pure and isomorphic (no server-only, no DOM, no
// domain import): nothing here knows what kind of document an image is, which subsystem stores it,
// or any business rule. A domain (e.g. vehicle documents) decides WHETHER to use these; adopting
// them is that domain's own decision and is never implied by sharing storage.

/** Decode guard: an image whose pixel count exceeds this is refused before it is decoded. */
export const MAX_IMAGE_PIXELS = 50_000_000; // 50 MP — above any current phone sensor (48 MP)

/** A normalized image: long edge and byte target. */
export const NORMALIZED_IMAGE_MAX_EDGE = 3000;
export const NORMALIZED_IMAGE_TARGET_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Tried in order until the output fits the target: (long edge, JPEG quality). */
export const NORMALIZATION_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: 3000, quality: 85 },
  { edge: 3000, quality: 75 },
  { edge: 2400, quality: 75 },
  { edge: 1800, quality: 70 },
];

// ISO-BMFF `ftyp` major brands of the HEIF family (Apple HEIC/HEIF stills and sequences). The
// server image stack (sharp's prebuilt libvips) ships NO HEVC decoder, so these cannot be decoded
// there. Detection is by signature, never by extension or declared MIME.
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
