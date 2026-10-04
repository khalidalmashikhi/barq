import "server-only";
import sharp from "sharp";
import { MAX_IMAGE_PIXELS, NORMALIZED_IMAGE_TARGET_BYTES, NORMALIZATION_STEPS } from "./image-safety-policy";

// DOCUMENT-NEUTRAL safe re-encoding of an image that will be stored PRIVATELY.
//
// Contract (nothing domain-specific — no document type, no PDF handling, no business rule, no
// storage call, no logging): given the bytes of a raster image the caller has ALREADY identified by
// signature, return a JPEG that is
//   • decoded under a pixel limit (the header is read first, so a decompression bomb is refused
//     before a single pixel is decoded);
//   • upright (EXIF orientation applied to the pixels);
//   • no larger than the normalized edge/byte target, and never enlarged;
//   • flattened (no transparency) and free of ALL metadata — EXIF incl. GPS, device make/model and
//     capture time; ICC; XMP; IPTC; embedded thumbnails.
//
// A domain opts in explicitly. Today only vehicle documents do; the provider-verification document
// subsystem does not call this and keeps storing its files exactly as it always has.

export type NormalizedImage =
  | { ok: true; bytes: ArrayBuffer; mimeType: "image/jpeg"; ext: "jpg" }
  | { ok: false; error: "IMAGE_CORRUPT" | "IMAGE_TOO_LARGE" };

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function normalizePrivateImage(bytes: ArrayBuffer): Promise<NormalizedImage> {
  const input = Buffer.from(bytes);

  // Header-only read: dimensions are known without decoding a single pixel. The pixel limit is
  // deliberately NOT applied to this read (it decodes nothing) so an over-limit image is told apart
  // from a corrupt one; the limit is enforced by the explicit check below AND again on every decode.
  let width: number, height: number;
  try {
    const meta = await sharp(input, { limitInputPixels: false, failOn: "error" }).metadata();
    if (!meta.width || !meta.height) return { ok: false, error: "IMAGE_CORRUPT" };
    width = meta.width;
    height = meta.height;
  } catch {
    return { ok: false, error: "IMAGE_CORRUPT" };
  }
  if (width * height > MAX_IMAGE_PIXELS) return { ok: false, error: "IMAGE_TOO_LARGE" };

  for (const step of NORMALIZATION_STEPS) {
    let out: Buffer;
    try {
      out = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" })
        .rotate() // apply the EXIF orientation, then the tag is gone with the rest of the metadata
        .resize({ width: step.edge, height: step.edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: step.quality, mozjpeg: true })
        .toBuffer(); // no withMetadata() → EXIF/GPS/ICC/thumbnails are NOT carried over
    } catch {
      return { ok: false, error: "IMAGE_CORRUPT" }; // valid signature, undecodable/truncated body
    }
    if (out.byteLength <= NORMALIZED_IMAGE_TARGET_BYTES) {
      return { ok: true, bytes: toArrayBuffer(out), mimeType: "image/jpeg", ext: "jpg" };
    }
  }
  return { ok: false, error: "IMAGE_TOO_LARGE" };
}
