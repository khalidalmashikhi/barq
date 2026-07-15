import type { Metadata } from "next";
import type { Locale } from "@/i18n/locales";
import { locales } from "@/i18n/locales";

// Localized metadata helper foundation — BARQ Internationalization,
// Phase 0.
//
// CONTRACT ONLY, NOT WIRED ANYWHERE YET: the two existing
// `generateMetadata()` implementations found during the architecture
// analysis (src/app/services/page.tsx, src/app/services/[id]/page.tsx)
// are untouched — neither imports this file. This exists so a later
// phase (Phase F: SEO/hreflang) has a single, ready-made shape to
// build real localized metadata + hreflang alternates against, rather
// than inventing that shape ad hoc once six more languages' worth of
// metadata is actually needed.
//
// hreflang/sitemap/robots generation is explicitly NOT implemented
// here, per this phase's out-of-scope list — buildLocalizedMetadata
// below only demonstrates the minimal shape (title/description per
// locale + language alternates); it is not called by any route.

export type LocalizedMetadataInput = {
  locale: Locale;
  /** Absolute pathname, without a locale prefix, e.g. "/services/123" — used to build hreflang alternates. */
  pathname: string;
  title: string;
  description?: string;
};

export function buildLocalizedMetadata({ locale, pathname, title, description }: LocalizedMetadataInput): Metadata {
  const languageAlternates = Object.fromEntries(locales.map((code) => [code, `/${code}${pathname}`]));

  return {
    title,
    description,
    alternates: {
      languages: languageAlternates,
    },
    other: {
      "current-locale": locale,
    },
  };
}
