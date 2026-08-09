// Magic-byte (file-signature) detection for the four allowed provider-document
// formats — Provider Verification & Documents (Gate 2, RC1). Reads only the
// leading bytes. Pure and isomorphic (no server-only), so it is unit-testable
// and reusable by a future mobile API. This is the SECOND, authoritative check
// that never trusts a client-declared Content-Type.

export type DocumentSignatureFormat = "pdf" | "jpeg" | "png" | "webp";

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detects the format from the leading bytes, or null if it matches none of the
 * four allowed signatures. SVG/HTML/text/unknown binaries all return null (they
 * have no matching magic number here).
 */
export function detectDocumentSignature(bytes: Uint8Array): DocumentSignatureFormat | null {
  // PDF: "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // WebP: "RIFF" .... "WEBP" (WEBP tag at byte offset 8)
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}
