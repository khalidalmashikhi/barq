import { defaultLocale, isValidLocale, type Locale } from "./locales";

// Active-locale resolution for the language switcher — BARQ i18n.
//
// WHY THIS EXISTS: the switcher's displayed locale used to come solely
// from next-intl's `useLocale()`. That value is served by the
// `NextIntlClientProvider` mounted in the ROOT layout (src/app/layout.tsx),
// which is the topmost shared layout. A soft client-side navigation
// between locales (the switcher navigates via a plain next/link, part of
// the duplicate-URL fix) preserves that shared root layout — it is not
// re-rendered — so the provider keeps serving the locale resolved at the
// initial page load. The page content under the [locale] segment updates,
// but `useLocale()` stays stale, leaving the label stuck on the previous
// language (e.g. showing "Čeština" while `/ar` renders Arabic).
//
// The routed URL is the always-fresh source of truth: next/navigation's
// `usePathname()` updates on every navigation, and `localePrefix: "always"`
// guarantees the current locale is the first path segment. These helpers
// derive the active locale from that segment, so the label and active
// indicator track the URL immediately after a route change.
//
// Native-script display names live here (moved from the switcher) so the
// URL→label mapping is a single, directly-testable unit — a Czech speaker
// sees "Čeština", not "Czech". The strings are unchanged.

export const LOCALE_LABELS: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  pl: "Polski",
  fr: "Français",
  cs: "Čeština",
  ru: "Русский",
};

/**
 * The routed locale = the leading path segment, when it is a valid locale.
 * Returns undefined for a path with no valid leading locale segment
 * (e.g. `/` or an unrecognized prefix).
 */
export function getLocaleFromPathname(pathname: string): Locale | undefined {
  const pathnameOnly = pathname.split("#")[0]!.split("?")[0]!;
  const firstSegment = pathnameOnly.split("/").filter((segment) => segment.length > 0)[0];
  return firstSegment !== undefined && isValidLocale(firstSegment) ? firstSegment : undefined;
}

/**
 * Resolve the locale to display in the switcher. The fresh routed URL wins;
 * `fallbackLocale` (next-intl's `useLocale()`) is used only when the path
 * carries no valid locale segment, and `defaultLocale` as a final guard.
 */
export function resolveActiveLocale(pathname: string, fallbackLocale?: string): Locale {
  return (
    getLocaleFromPathname(pathname) ??
    (fallbackLocale !== undefined && isValidLocale(fallbackLocale) ? fallbackLocale : defaultLocale)
  );
}
