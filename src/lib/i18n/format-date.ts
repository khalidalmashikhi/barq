import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";
import type { Locale } from "@/i18n/locales";

// Locale-aware date/time formatting utilities — BARQ Internationalization,
// Phase 0, wired to real call sites in Phase A.5 Group 7.
//
// FRAMEWORK-INDEPENDENT, DELIBERATELY: no React, no Next.js, no
// next-intl import here — these are plain functions over the native
// `Intl` API, callable from any layer (Server Component, Client
// Component, a future API route, or a future React Native app) per
// this task's "keep formatting independent from React and Next.js"
// requirement and ADR-0011's platform-independence principle.
//
// REUSES OMAN_TIME_ZONE, DOES NOT RE-HARDCODE IT: every call site
// found during the architecture analysis that formats a date
// hardcoded `timeZone: "Asia/Muscat"` (or omitted it) alongside a
// hardcoded `"ar-OM"` locale argument. This module fixes the second
// problem (locale is now an explicit parameter) while deliberately
// reusing the exact same constant already established for the first
// problem (src/lib/date/oman-timezone.ts) — not introducing a second,
// competing timezone value.
//
// "ar" MAPS TO "ar-OM", EVERY OTHER LOCALE PASSES THROUGH UNCHANGED:
// every pre-Group-7 call site hardcoded the BCP-47 tag "ar-OM", not
// bare "ar" — `Intl.DateTimeFormat("ar-OM")` renders Eastern Arabic-
// Indic digits ("١١ يوليو") while bare "ar" renders Western digits
// ("11 يوليو"), a real, visible difference verified directly against
// Node's ICU data before this migration. Callers pass the app's own
// `Locale` type (e.g. "ar", "en" from next-intl's getLocale()), and
// toIntlLocaleTag() below is the one place that restores the "-OM"
// regional tag for Arabic specifically, preserving every existing
// call site's exact rendered output byte-for-byte. No other locale
// had a pre-existing regional convention to preserve, so all 7 others
// pass through as-is.
//
// PURE, NON-MUTATING: every function returns a new formatted string;
// none of them ever mutate the `Date` passed in or any stored value.

function toIntlLocaleTag(locale: Locale): string {
  return locale === "ar" ? "ar-OM" : locale;
}

export function formatDate(date: Date, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(toIntlLocaleTag(locale), {
    timeZone: OMAN_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatTime(date: Date, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(toIntlLocaleTag(locale), {
    timeZone: OMAN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatDateTime(date: Date, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(toIntlLocaleTag(locale), {
    timeZone: OMAN_TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
    ...options,
  }).format(date);
}
