// Media Foundation (Gap C) — shared, framework-agnostic constants and
// validation for user-uploaded images. Deliberately pure (no next/react,
// no server-only, no Supabase, no Prisma import) so every rule here is
// unit-testable in the node test env and reusable across provider media
// (logo/cover/portfolio) and, later, service media (cover/gallery) —
// "one reusable media foundation," not a per-surface copy.

// Owner discriminators — mirror the Prisma `MediaOwnerType` enum. Kept as
// string-literal unions here so this file stays Prisma-free (see above);
// the enum is the source of truth at the DB layer.
export type MediaOwnerType = "PROVIDER" | "SERVICE";

// The concrete role a piece of media plays for its owner. Mirrors the
// Prisma `MediaKind` enum. LOGO is the only kind wired end-to-end in this
// first slice; the rest are defined now so the model/migration don't need
// re-cutting when cover/portfolio/gallery surfaces land.
export type MediaKind = "LOGO" | "COVER" | "PORTFOLIO" | "GALLERY";

// Accepted image MIME types → canonical file extension. Intentionally a
// small allow-list (never a deny-list): only web-safe, next/image- and
// Supabase-friendly raster formats. SVG is deliberately excluded — it can
// carry active content (script/foreignObject) and is an XSS vector when
// served from our own storage host.
export const ALLOWED_IMAGE_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedImageMimeType = keyof typeof ALLOWED_IMAGE_MIME_TYPES;

// 5 MB — comfortably covers a high-quality logo/cover photo while keeping
// request bodies small enough to flow through a serverless function
// without special body-size configuration.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Upper bound on a provider's portfolio/gallery images — a sane cap that
// keeps gallery queries and the public grid bounded (Rule 8, performance).
export const MAX_PROVIDER_PORTFOLIO_ITEMS = 12;

// Upper bound on a service's gallery images — same bounded-query rationale.
export const MAX_SERVICE_GALLERY_ITEMS = 12;

export type ImageValidationError = "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EMPTY_FILE";

export type ImageValidationResult =
  | { ok: true; mimeType: AllowedImageMimeType; ext: string }
  | { ok: false; error: ImageValidationError };

function isAllowedImageMimeType(value: string): value is AllowedImageMimeType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_MIME_TYPES, value);
}

// Validate an uploaded image purely from its declared type and byte size.
// (Deep magic-byte sniffing is intentionally out of scope for this slice —
// the allow-list + size cap + a non-executable format set is the pragmatic,
// non-overengineered guard; content-sniffing can be layered on later.)
export function validateImageUpload(input: { type: string; size: number }): ImageValidationResult {
  if (input.size <= 0) {
    return { ok: false, error: "EMPTY_FILE" };
  }
  if (input.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  if (!isAllowedImageMimeType(input.type)) {
    return { ok: false, error: "UNSUPPORTED_TYPE" };
  }
  return { ok: true, mimeType: input.type, ext: ALLOWED_IMAGE_MIME_TYPES[input.type] };
}
