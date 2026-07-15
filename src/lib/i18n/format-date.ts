import { OMAN_TIME_ZONE } from "@/lib/date/oman-timezone";

// Locale-aware date/time formatting utilities — BARQ Internationalization,
// Phase 0.
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
// PURE, NON-MUTATING: every function returns a new formatted string;
// none of them ever mutate the `Date` passed in or any stored value.
//
// NOT YET WIRED TO ANY CALL SITE: per this phase's explicit scope, the
// 13 existing date-formatting call sites found during the architecture
// analysis are NOT migrated to use these functions yet — that is
// later-phase work (Phase D primarily, since most of those call sites
// are in the Provider Dashboard).

export function formatDate(date: Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: OMAN_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatTime(date: Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: OMAN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatDateTime(date: Date, locale: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: OMAN_TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
    ...options,
  }).format(date);
}
