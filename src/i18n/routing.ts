import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./locales";

// next-intl routing configuration — BARQ Internationalization, Phase 0.
//
// localePrefix: "always" means every locale, including Arabic, is
// served under an explicit prefix (/ar/..., /en/...) — a permanent
// decision from the approved architecture analysis: an unprefixed
// root that implicitly means "Arabic" was rejected in favor of a
// symmetric, self-describing URL for every locale.
//
// locales/defaultLocale are imported from the single source of truth
// (./locales.ts) — never re-declared here.

// alternateLinks: false — Phase B Group 5 Closure. next-intl's default
// (true) has the middleware emit an HTTP `Link` header with hreflang
// alternates on every route it matches — including private,
// authenticated ones — and its x-default entry pointed at the
// unprefixed legacy path (resolved only via the Groups 1-4 compat
// redirects), inconsistent with the direct, non-redirected
// canonical/hreflang HTML tags Group 5 added to the public pages.
// HTML metadata (src/lib/i18n/metadata.ts) is now the single source
// of truth for hreflang. This does not affect locale detection, the
// redirect chain, or middleware.ts's matcher.
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  alternateLinks: false,
});
