// Preview-mode contract — Unified Preview System.
//
// A tiny, explicit presentation flag shared by the customer-facing service
// detail and its provider/admin previews. It governs ONLY presentation
// behavior (show a preview banner, suppress the booking CTA, allow rendering
// of not-yet-public content that authorization already permitted upstream).
// It is NEVER used to bypass authorization or any business rule — the reads
// and RBAC gates decide what may be shown; this only decides how it looks.

export type PreviewMode = "public" | "provider-preview" | "admin-preview";

// True for any non-public preview. Used to gate the banner and to swap the
// active booking CTA for a disabled placeholder.
export function isPreview(mode: PreviewMode): boolean {
  return mode !== "public";
}
