// Locale source of truth — BARQ Internationalization, Phase 0.
//
// The ONE place the 8 officially targeted locale codes (ADR-0010) are
// enumerated. Every other i18n infrastructure file (routing.ts,
// middleware.ts, request.ts, the [locale] layout, future call sites)
// imports from here — never re-declares its own copy of this list.
//
// Arabic (`ar`) is first in the array deliberately: it is both the
// default locale and the platform's primary identity commitment
// (ADR-0005/PROJECT_MANIFEST.md Core Value 4), not merely one entry
// among eight equals in ordering.

export const locales = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

// Only Arabic is RTL among the 8 currently approved locales — a
// permanent decision (this task's own scope), not inferred from any
// external library's notion of "RTL languages in general" (which
// would incorrectly include languages BARQ does not target and could
// silently mis-classify a future addition).
const rtlLocales: ReadonlySet<Locale> = new Set(["ar"]);

export type Direction = "rtl" | "ltr";

export function getLocaleDirection(locale: Locale): Direction {
  return rtlLocales.has(locale) ? "rtl" : "ltr";
}

export function isValidLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
