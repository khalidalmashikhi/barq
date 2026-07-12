// Bilingual content extraction — Engineering Sprint (Stabilization:
// deduplicate multilingual text extraction helper).
//
// Single source of truth for reading the Arabic value out of a
// bilingual `Json` locale-map field (e.g. `{ "ar": "...", "en": "..." }`
// — the storage shape ADR-0005/PRISMA_SCHEMA.md establish for
// Service.name, Provider.businessName, etc.). Previously defined
// independently, with byte-identical logic, in five separate files
// (get-service-detail.ts, get-services.ts, get-booking-detail.ts,
// get-my-bookings.ts, get-dashboard-data.ts — the last one under the
// name extractArabicText) — a direct violation of PROJECT_RULES.md
// §22's "no Bounded Context silently duplicates... logic." Behavior is
// unchanged: still reads only the "ar" key, still returns "" for any
// non-object, missing-key, or non-string-value case, exactly as every
// prior copy did — callers already apply their own `|| "fallback"`
// after calling this, so an empty-string "ar" value is handled
// identically to before.
//
// Lives alongside strings.ts (not marked server-only, matching that
// file's own precedent) rather than in any one feature's lib folder,
// since it is a generic i18n concern, not booking/service/dashboard
// business logic.
//
// NOT a resolution of ADR-0010's 8-language target — this still
// extracts only "ar", unchanged from every prior copy. Accepting a
// locale parameter instead of hardcoding "ar" is a real future
// improvement once the actual i18n architecture migration (ADR-0010's
// own Process Requirement) happens — out of scope here, per explicit
// instruction not to change localization behavior or introduce a new
// localization architecture in this refactor.

export function extractText(value: unknown): string {
  if (value && typeof value === "object" && "ar" in value) {
    const ar = (value as { ar?: unknown }).ar;
    if (typeof ar === "string") return ar;
  }
  return "";
}
