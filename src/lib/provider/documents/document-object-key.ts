// Private document object-key + filename handling — Gate 2. Pure/isomorphic.
//
// The storage key NEVER contains the user's filename (path-traversal / injection
// safety). Layout mirrors buildMediaObjectKey's convention but under a private
// prefix: `provider-documents/{providerId}/{type}/{uuid}.{ext}`. The `unique`
// segment (a fresh uuid) is injected by the caller so this stays pure/testable,
// exactly like buildMediaObjectKey.

export function buildDocumentObjectKey(params: {
  providerId: string;
  type: string;
  ext: string;
  unique: string;
}): string {
  return `provider-documents/${params.providerId}/${params.type.toLowerCase()}/${params.unique}.${params.ext}`;
}

const MAX_FILENAME_LENGTH = 120;

/**
 * Sanitizes the client-supplied original filename for safe STORAGE AS METADATA
 * and safe use in a download Content-Disposition — never for the object key.
 * Strips path separators and control characters, collapses whitespace, caps
 * length, and falls back to a safe default. This value is display-only.
 */
export function sanitizeOriginalFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_") // no path separators
    .replace(/[\x00-\x1f\x7f]/g, "") // no control chars
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "document";
  return safe.slice(0, MAX_FILENAME_LENGTH);
}
