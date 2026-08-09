import { describe, it, expect } from "vitest";
import { validateDocumentUpload, MAX_DOCUMENT_BYTES } from "./document-constants";

function bytes(...b: number[]): Uint8Array {
  return Uint8Array.from(b);
}
function ascii(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
}
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe("validateDocumentUpload", () => {
  it("accepts a valid PDF/JPEG/PNG/WebP whose MIME and signature agree", () => {
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: 1000, head: PDF })).toEqual({
      ok: true, ext: "pdf", format: "pdf", mimeType: "application/pdf",
    });
    expect(validateDocumentUpload({ declaredMimeType: "image/jpeg", sizeBytes: 1000, head: JPEG })).toMatchObject({ ok: true, ext: "jpg" });
    expect(validateDocumentUpload({ declaredMimeType: "image/png", sizeBytes: 1000, head: PNG })).toMatchObject({ ok: true, ext: "png" });
    expect(validateDocumentUpload({ declaredMimeType: "image/webp", sizeBytes: 1000, head: WEBP })).toMatchObject({ ok: true, ext: "webp" });
  });

  it("rejects an empty file", () => {
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: 0, head: PDF })).toEqual({ ok: false, error: "EMPTY_FILE" });
  });

  it("accepts exactly the cap and rejects one byte over (inclusive cap)", () => {
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: MAX_DOCUMENT_BYTES, head: PDF })).toMatchObject({ ok: true });
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: MAX_DOCUMENT_BYTES + 1, head: PDF })).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("cap is 4 MB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
  });

  it("rejects unsupported declared MIME (SVG / HTML)", () => {
    expect(validateDocumentUpload({ declaredMimeType: "image/svg+xml", sizeBytes: 100, head: ascii("<svg") })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(validateDocumentUpload({ declaredMimeType: "text/html", sizeBytes: 100, head: ascii("<html>") })).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });

  it("rejects HTML bytes declared as PDF (fake PDF)", () => {
    expect(validateDocumentUpload({ declaredMimeType: "application/pdf", sizeBytes: 100, head: ascii("<!DOCTYPE html><html>") })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it("rejects PNG bytes declared as JPEG (MIME/signature disagreement)", () => {
    expect(validateDocumentUpload({ declaredMimeType: "image/jpeg", sizeBytes: 100, head: PNG })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });

  it("rejects an unknown binary declared as an allowed type", () => {
    expect(validateDocumentUpload({ declaredMimeType: "image/png", sizeBytes: 100, head: bytes(0x00, 0x01, 0x02, 0x03) })).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
  });
});
