import { describe, it, expect } from "vitest";
import { detectDocumentSignature } from "./document-signature";

function bytes(...b: number[]): Uint8Array {
  return Uint8Array.from(b);
}
function ascii(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
}

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34); // %PDF-1.4
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50); // RIFF....WEBP

describe("detectDocumentSignature", () => {
  it("detects each allowed format from its magic bytes", () => {
    expect(detectDocumentSignature(PDF)).toBe("pdf");
    expect(detectDocumentSignature(JPEG)).toBe("jpeg");
    expect(detectDocumentSignature(PNG)).toBe("png");
    expect(detectDocumentSignature(WEBP)).toBe("webp");
  });

  it("returns null for SVG / HTML / plain text", () => {
    expect(detectDocumentSignature(ascii("<svg xmlns=..."))).toBeNull();
    expect(detectDocumentSignature(ascii("<!DOCTYPE html><html>"))).toBeNull();
    expect(detectDocumentSignature(ascii("just some text"))).toBeNull();
  });

  it("returns null for unknown binary", () => {
    expect(detectDocumentSignature(bytes(0x00, 0x01, 0x02, 0x03, 0x04))).toBeNull();
  });

  it("requires the WEBP tag at offset 8 (RIFF alone is not enough)", () => {
    // RIFF container that is NOT WebP (e.g. WAV) → null
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
    expect(detectDocumentSignature(wav)).toBeNull();
  });

  it("does not over-read a too-short buffer", () => {
    expect(detectDocumentSignature(bytes(0x52, 0x49, 0x46, 0x46))).toBeNull(); // RIFF but truncated
    expect(detectDocumentSignature(bytes())).toBeNull();
  });
});
