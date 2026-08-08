import type { ReactNode } from "react";

// Root layout — intentionally a PASS-THROUGH (BARQ i18n stabilization).
//
// WHY IT RENDERS NO <html>/<body>: locale, document direction, and the
// client-side message provider must all derive from the URL's [locale]
// segment AND re-render whenever the locale changes. This layout sits ABOVE
// the [locale] segment, so on a soft locale-switch navigation (/ar -> /en)
// Next.js preserves it and does NOT re-render it. When <html lang/dir> and
// NextIntlClientProvider lived here, they went stale on such a switch: the
// [locale] subtree re-rendered in the new locale (server text) while this
// layout's provider kept serving the OLD locale to every Client Component
// (and <html dir> kept the old direction) — producing mixed-language UI and
// wrong RTL/LTR. They now live in src/app/[locale]/layout.tsx, which DOES
// re-render on a locale switch, making the URL the single source of truth.
//
// Next.js requires <html>/<body> somewhere in each route's rendered chain:
// they are provided by src/app/[locale]/layout.tsx for every real route,
// and by src/app/not-found.tsx (invalid-locale / unmatched) and
// src/app/global-error.tsx (fatal errors), which render their own.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
