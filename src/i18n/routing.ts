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

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});
