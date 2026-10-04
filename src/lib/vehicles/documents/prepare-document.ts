import "server-only";
import sharp from "sharp";
import { validateDocumentUpload } from "@/lib/provider/documents/document-constants";
import { extractPdfText } from "@/lib/vehicles/registration-extraction/pdf-text";
import { MAX_REGISTRATION_PDF_PAGES } from "@/lib/vehicles/registration-extraction/constants";
import {
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_PIXELS,
  NORMALIZED_IMAGE_TARGET_BYTES,
  NORMALIZATION_STEPS,
  isHeicSignature,
} from "./document-upload-policy";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// Phase 3C Slice 3B — turn an uploaded vehicle document into the bytes we are willing to STORE.
// The single server-side authority for every vehicle-document entry point (onboarding upload,
// document upload, document replace). It trusts nothing about the request except the bytes.
//
// IMAGES are always re-encoded, never stored as received:
//   size ceiling → signature (never extension/MIME alone) → header-only dimension check (a
//   decompression bomb is refused BEFORE any decode) → decode with a pixel limit → apply the EXIF
//   orientation → resize only if larger than the target → flatten transparency → re-encode as JPEG.
//   The re-encode drops ALL metadata (EXIF, GPS, maker notes, ICC, embedded thumbnails), so a photo
//   of a registration card never carries where or on what device it was taken.
//
// PDFs are stored unchanged (never rasterized). A REGISTRATION PDF is additionally opened with the
// bounded Slice-2 parser so an encrypted, corrupt, polyglot or over-long file is refused now rather
// than after it has been stored (a scanned PDF with no text layer is fine — it goes to manual review).
//
// HEIC/HEIF is refused explicitly: the bundled image library has no HEVC decoder.

export type PrepareDocumentError = Extract<
  AssetDocumentErrorCode,
  "EMPTY_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH" | "HEIC_UNSUPPORTED" | "IMAGE_TOO_LARGE" | "IMAGE_CORRUPT" | "PDF_ENCRYPTED" | "PDF_CORRUPT" | "PDF_TOO_MANY_PAGES"
>;

export type PreparedDocument =
  | { ok: true; bytes: ArrayBuffer; mimeType: "application/pdf" | "image/jpeg"; ext: "pdf" | "jpg"; normalized: boolean }
  | { ok: false; error: PrepareDocumentError };

export type PrepareDocumentInput = {
  declaredMimeType: string;
  bytes: ArrayBuffer;
  /** REGISTRATION → the PDF is structurally checked (encrypted / corrupt / page limit). */
  pdfPolicy?: "REGISTRATION" | "NONE";
};

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function normalizeImage(input: Buffer): Promise<PreparedDocument> {
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
      return { ok: true, bytes: toArrayBuffer(out), mimeType: "image/jpeg", ext: "jpg", normalized: true };
    }
  }
  return { ok: false, error: "IMAGE_TOO_LARGE" };
}

async function checkRegistrationPdf(bytes: ArrayBuffer): Promise<PrepareDocumentError | null> {
  // The PDF engine TRANSFERS (detaches) the buffer it is given, leaving it zero-length. The check
  // therefore runs on a COPY — the original bytes are what gets stored.
  const result = await extractPdfText(bytes.slice(0), { maxPages: MAX_REGISTRATION_PDF_PAGES });
  if (result.ok) return null;
  switch (result.code) {
    case "PDF_ENCRYPTED":
      return "PDF_ENCRYPTED";
    case "PDF_MALFORMED":
    case "PDF_TRAILING_DATA":
    case "EXTRACTION_FAILED": // the bounded parser could not open it at all → fail closed
      return "PDF_CORRUPT";
    case "PDF_PAGE_LIMIT":
      return "PDF_TOO_MANY_PAGES";
    default:
      // NO_TEXT_LAYER (a scan), TEXT_LIMIT_EXCEEDED, PARSER_TIMEOUT — the file opened as a PDF; it
      // simply cannot be read automatically → stored and sent to manual review.
      return null;
  }
}

export async function prepareDocumentForStorage(input: PrepareDocumentInput): Promise<PreparedDocument> {
  const size = input.bytes.byteLength;
  if (size <= 0) return { ok: false, error: "EMPTY_FILE" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_LARGE" }; // before any parsing/decoding

  const head = new Uint8Array(input.bytes, 0, Math.min(size, 32));
  if (isHeicSignature(head)) return { ok: false, error: "HEIC_UNSUPPORTED" };

  // Declared MIME must be on the allow-list AND agree with the magic bytes (a renamed file fails).
  const validation = validateDocumentUpload({ declaredMimeType: input.declaredMimeType, sizeBytes: size, head });
  if (!validation.ok) return { ok: false, error: validation.error };

  if (validation.format === "pdf") {
    if (input.pdfPolicy === "REGISTRATION") {
      const problem = await checkRegistrationPdf(input.bytes);
      if (problem) return { ok: false, error: problem };
    }
    return { ok: true, bytes: input.bytes, mimeType: "application/pdf", ext: "pdf", normalized: false };
  }

  return normalizeImage(Buffer.from(input.bytes));
}
