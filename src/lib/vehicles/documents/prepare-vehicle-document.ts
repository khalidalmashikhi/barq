import "server-only";
import { validateDocumentUpload } from "@/lib/provider/documents/document-constants";
import { isHeicSignature } from "@/lib/file-safety/image-safety-policy";
import { normalizePrivateImage } from "@/lib/file-safety/normalize-private-image";
import { checkRegistrationPdfStructure } from "@/lib/vehicles/registration-extraction/registration-pdf-policy";
import { MAX_UPLOAD_BYTES } from "./document-upload-policy";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// Phase 3C Slice 3B — the VEHICLE-DOCUMENT upload policy: what the vehicle domain is willing to
// store for an AssetDocument. It is the single authority for the three vehicle entry points
// (onboarding upload, vehicle-document upload, vehicle-document replace) and ONLY for them. It is
// not, and must not become, a rule for provider-verification documents: that subsystem
// (src/lib/provider/documents) has its own types, limits and validation and does not call this.
//
// Three layers, kept apart on purpose:
//   1. GENERIC file safety (src/lib/file-safety) — document-neutral: signature helpers and the safe
//      re-encoding of a private image. Knows nothing about vehicles.
//   2. THIS policy — vehicle documents: the upload ceiling, the accepted formats, the HEIC refusal,
//      "every image is normalized", "a PDF is stored unchanged".
//   3. REGISTRATION-only rule (registration-extraction/registration-pdf-policy) — applied to the
//      VEHICLE_REGISTRATION type alone: the PDF must open in the registration parser and respect
//      its page limit. Insurance and any future vehicle document type are NOT subject to it.

export type PrepareVehicleDocumentError = Extract<
  AssetDocumentErrorCode,
  "EMPTY_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "SIGNATURE_MISMATCH" | "HEIC_UNSUPPORTED" | "IMAGE_TOO_LARGE" | "IMAGE_CORRUPT" | "PDF_ENCRYPTED" | "PDF_CORRUPT" | "PDF_TOO_MANY_PAGES"
>;

export type PreparedVehicleDocument =
  | { ok: true; bytes: ArrayBuffer; mimeType: "application/pdf" | "image/jpeg"; ext: "pdf" | "jpg"; normalized: boolean }
  | { ok: false; error: PrepareVehicleDocumentError };

export type PrepareVehicleDocumentInput = {
  /** The vehicle document type being stored (AssetDocument.type) — decides which type-specific
   *  rule, if any, applies. An unknown type gets no type-specific rule. */
  documentType: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

export async function prepareVehicleDocumentForStorage(input: PrepareVehicleDocumentInput): Promise<PreparedVehicleDocument> {
  const size = input.bytes.byteLength;
  if (size <= 0) return { ok: false, error: "EMPTY_FILE" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_LARGE" }; // before any parsing/decoding

  // HEIC/HEIF is refused explicitly (the server image stack cannot decode it) — by signature, so a
  // renamed file still gets the clear message rather than a generic mismatch.
  const head = new Uint8Array(input.bytes, 0, Math.min(size, 32));
  if (isHeicSignature(head)) return { ok: false, error: "HEIC_UNSUPPORTED" };

  // Declared MIME must be on the allow-list AND agree with the magic bytes (a renamed file fails).
  const validation = validateDocumentUpload({ declaredMimeType: input.declaredMimeType, sizeBytes: size, head });
  if (!validation.ok) return { ok: false, error: validation.error };

  if (validation.format === "pdf") {
    // PDFs are stored byte-for-byte (never rasterized). Only a REGISTRATION document gets the
    // registration-specific structural rule; every other vehicle document type is stored as-is.
    if (input.documentType === "VEHICLE_REGISTRATION") {
      const problem = await checkRegistrationPdfStructure(input.bytes);
      if (problem) return { ok: false, error: problem };
    }
    return { ok: true, bytes: input.bytes, mimeType: "application/pdf", ext: "pdf", normalized: false };
  }

  // Every vehicle-document image is re-encoded, never stored as received.
  const image = await normalizePrivateImage(input.bytes);
  if (!image.ok) return { ok: false, error: image.error };
  return { ok: true, bytes: image.bytes, mimeType: image.mimeType, ext: image.ext, normalized: true };
}
