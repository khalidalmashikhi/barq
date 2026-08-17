import type { Locale } from "@/i18n/locales";

// Deterministic fallback resolver for admin-editable bilingual config content.
//
// Policy (approved): requested locale → English → built-in application default.
// BARQ has 8 locales, but the first template migration seeds only { ar, en } and
// the app must NOT require every locale to carry hand-authored DB content — so a
// missing/blank requested locale falls back to `en`, and a missing/blank `en`
// falls back to the code default passed by the caller. Pure (no prisma/next).

export function resolveConfigText(value: unknown, locale: Locale, fallback: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const map = value as Record<string, unknown>;
    const requested = map[locale];
    if (typeof requested === "string" && requested.trim() !== "") return requested;
    const english = map.en;
    if (typeof english === "string" && english.trim() !== "") return english;
  }
  return fallback;
}
