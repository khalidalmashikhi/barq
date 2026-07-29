import type { Locale } from "@/i18n/locales";

// Public absolute-URL helper — Growth Foundations phase.
//
// Single place for the same NEXT_PUBLIC_APP_URL-with-localhost-fallback
// logic already duplicated inline in src/app/layout.tsx (root
// metadataBase) — reused here by sitemap.ts, the two opengraph-image
// routes, and every Share button call site, so all four agree on
// exactly the same origin without repeating the fallback themselves.
// Framework-independent (no "server-only" import): safe to import from
// both Server Components and the client-side Share button's server-
// rendered parent.

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Locale-prefixed absolute URL, e.g. buildPublicUrl("en", "/services/123") -> "https://example.com/en/services/123". */
export function buildPublicUrl(locale: Locale, pathname: string): string {
  return `${getAppUrl()}/${locale}${pathname}`;
}
