import { detectDocumentSignature } from "@/lib/provider/documents/document-signature";
import {
  MAX_UPLOAD_BYTES,
  CLIENT_MAX_SOURCE_BYTES,
  CLIENT_UPLOAD_TARGET_BYTES,
  CLIENT_DOWNSIZE_STEPS,
  isHeicSignature,
  fitWithin,
} from "./document-upload-policy";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// Phase 3C Slice 3B — BROWSER-SIDE preparation of the chosen document, run just before upload.
//
// Why it exists: the server can only receive ~4 MB (a platform limit), while an ordinary phone photo
// is often 3–12 MB. So a photo larger than the target is downsized on the device (canvas → JPEG,
// long edge ≤ 3000 px), which also applies its orientation and drops its EXIF/GPS before it ever
// leaves the phone. PDFs are never altered.
//
// This is a CONVENIENCE, not a control: the server re-validates and re-normalizes every upload and
// does not trust anything done here. The decision logic (planUpload) is pure and unit-tested; the
// canvas work can only run in a browser.

export type UploadPlan =
  | { action: "SEND_AS_IS"; mimeType: "application/pdf" | "image/jpeg" | "image/png" }
  | { action: "DOWNSIZE"; isHeic: boolean }
  | { action: "REJECT"; error: AssetDocumentErrorCode };

/** Decide what to do with a chosen file from its leading bytes and size alone (pure). */
export function planUpload(head: Uint8Array, sizeBytes: number): UploadPlan {
  if (sizeBytes <= 0) return { action: "REJECT", error: "EMPTY_FILE" };

  const heic = isHeicSignature(head);
  const signature = heic ? null : detectDocumentSignature(head);

  if (signature === "pdf") {
    return sizeBytes > MAX_UPLOAD_BYTES ? { action: "REJECT", error: "TOO_LARGE" } : { action: "SEND_AS_IS", mimeType: "application/pdf" };
  }
  if (!heic && signature !== "jpeg" && signature !== "png" && signature !== "webp") {
    return { action: "REJECT", error: "UNSUPPORTED_TYPE" };
  }
  if (sizeBytes > CLIENT_MAX_SOURCE_BYTES) return { action: "REJECT", error: "TOO_LARGE" };

  // A JPEG/PNG already under the target goes up untouched (the server normalizes it anyway).
  if ((signature === "jpeg" || signature === "png") && sizeBytes <= CLIENT_UPLOAD_TARGET_BYTES) {
    return { action: "SEND_AS_IS", mimeType: signature === "jpeg" ? "image/jpeg" : "image/png" };
  }
  // Too big for the request, or a format the server does not take (WebP is fine server-side but is
  // re-encoded here for one predictable path; HEIC only if THIS browser can decode it).
  return { action: "DOWNSIZE", isHeic: heic };
}

export type PreparedUpload = { ok: true; blob: Blob; filename: string } | { ok: false; error: AssetDocumentErrorCode };

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "document";
  return `${base}.jpg`;
}

async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void } | null> {
  // createImageBitmap honours EXIF orientation when asked; fall back to an <img> (which applies it by
  // default in current browsers) where the option or the format is not supported.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

/** Downsize an image to a JPEG under the upload target. Null when this browser cannot decode it. */
async function downsize(file: Blob): Promise<Blob | null | "TOO_LARGE"> {
  const decoded = await decodeImage(file);
  if (!decoded) return null;
  try {
    for (const step of CLIENT_DOWNSIZE_STEPS) {
      const { width, height } = fitWithin(decoded.width, decoded.height, step.edge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff"; // flatten transparency
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(decoded.source, 0, 0, width, height);
      const blob = await canvasToJpeg(canvas, step.quality);
      canvas.width = 0; // release the backing store promptly (matters on phones)
      canvas.height = 0;
      if (blob && blob.size <= CLIENT_UPLOAD_TARGET_BYTES) return blob;
    }
    return "TOO_LARGE";
  } finally {
    decoded.release();
  }
}

/** Prepare a chosen file for upload (browser only). Never throws; returns a coded outcome. */
export async function prepareFileForUpload(file: File): Promise<PreparedUpload> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  } catch {
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  const plan = planUpload(head, file.size);
  if (plan.action === "REJECT") return { ok: false, error: plan.error };
  if (plan.action === "SEND_AS_IS") {
    // Re-wrap with the type proven by the signature (some pickers report an empty/odd MIME).
    return { ok: true, blob: file.slice(0, file.size, plan.mimeType), filename: file.name };
  }

  const result = await downsize(file);
  if (result === "TOO_LARGE") return { ok: false, error: "IMAGE_TOO_LARGE" };
  if (result) return { ok: true, blob: result, filename: jpegName(file.name) };

  // This browser could not decode the image.
  if (plan.isHeic) return { ok: false, error: "HEIC_UNSUPPORTED" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "TOO_LARGE" };
  return { ok: false, error: "IMAGE_CORRUPT" };
}
