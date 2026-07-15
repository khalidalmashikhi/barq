import type { Locale } from "@/i18n/locales";

// Locale-aware multilingual database-content extraction — BARQ
// Internationalization, Phase 0.
//
// DOES NOT REPLACE extract-text.ts YET, PER EXPLICIT SCOPE: the
// existing extractText() (src/lib/i18n/extract-text.ts) is untouched
// and still used by every current call site — this is a new, separate
// helper, added alongside it, not a migration.
//
// SEPARATE FROM UI TRANSLATION, DELIBERATELY: this reads BARQ's
// existing `Json` locale-map database fields (Service.name,
// Provider.businessName, etc. — ADR-0005 requirement 7 / ADR-0010
// requirement 11), never the next-intl message catalogs. The two
// systems solve different problems (translated UI strings vs.
// translated business-entity content) and stay architecturally
// distinct, per this task's explicit "existing database multilingual
// JSON content remains separate from UI translation" decision.
//
// FALLBACK ORDER: requested locale -> Arabic -> English -> "" (only
// if no usable value exists at all) — matching LOCALIZATION.md §3's
// already-resolved database-content fallback chain exactly, now
// generalized from Arabic-only (extractText's current behavior) to
// any of the 8 target locales. A present-but-empty string at any
// level is treated as unusable and falls through to the next level —
// a deliberate refinement over extractText()'s current behavior
// (which returns "" immediately once the "ar" key exists at all,
// even if blank), stated here explicitly since it is a real, if
// small, behavioral difference from the helper this one sits
// alongside, not silently identical.

export function extractLocalizedText(value: unknown, locale: Locale): string {
  if (!value || typeof value !== "object") return "";

  const localeMap = value as Record<string, unknown>;

  const requested = localeMap[locale];
  if (typeof requested === "string" && requested.length > 0) return requested;

  const arabic = localeMap.ar;
  if (typeof arabic === "string" && arabic.length > 0) return arabic;

  const english = localeMap.en;
  if (typeof english === "string" && english.length > 0) return english;

  return "";
}
