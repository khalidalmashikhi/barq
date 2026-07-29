import type { Metadata } from "next";
import type { Locale } from "@/i18n/locales";
import { locales, defaultLocale } from "@/i18n/locales";

// Localized metadata helper — BARQ Internationalization.
//
// Wired into every indexable public route as of Phase B Group 5
// (src/app/[locale]/page.tsx, src/app/[locale]/services/page.tsx,
// src/app/[locale]/services/[id]/page.tsx) — no longer a Phase 0
// contract-only scaffold. Builds a self-referential canonical, hreflang
// alternates for all 8 supported locales plus x-default, and matching
// Open Graph fields, from a single locale-agnostic pathname (e.g.
// "/services/123") so each call site only supplies its own
// already-translated title/description.
//
// Callers must NOT include query strings in `pathname` — filter/sort/
// page state is intentionally excluded from canonical/hreflang so
// every query-string variant of a listing page still canonicalizes to
// the same bare URL, rather than fragmenting SEO signal per filter
// combination.
//
// Relies on `metadataBase` being set once at the root layout
// (src/app/layout.tsx) to resolve these relative paths into absolute
// URLs — this file deliberately never constructs an absolute URL
// itself.

export type LocalizedMetadataInput = {
  locale: Locale;
  /** Locale-agnostic pathname, no locale prefix and no query string, e.g. "/services/123" or "" for the homepage. */
  pathname: string;
  title: string;
  description?: string;
  /**
   * Growth Foundations phase — optional Open Graph / Twitter image
   * override, additive and backward compatible: every pre-existing
   * caller omits this and keeps getting the static `/Barqlogo.png`
   * exactly as before. Only Service Detail and Provider Detail pass
   * this today, pointing at their own dynamic opengraph-image.tsx route
   * (an absolute URL, since Next.js's file-convention OG image is
   * otherwise silently skipped whenever a page's own metadata already
   * sets `openGraph.images` — confirmed live: without this override, a
   * page that already calls buildLocalizedMetadata() kept showing the
   * static logo instead of ever picking up its sibling
   * opengraph-image.tsx route).
   */
  images?: string[];
};

/// Facebook's Open Graph locale format (language_TERRITORY) for each of
/// the 8 supported locales — a fixed, conventional mapping, not a
/// translated value, so it lives in code rather than messages/*.json.
const openGraphLocales: Record<Locale, string> = {
  ar: "ar_AR",
  en: "en_US",
  de: "de_DE",
  it: "it_IT",
  pl: "pl_PL",
  fr: "fr_FR",
  cs: "cs_CZ",
  ru: "ru_RU",
};

// Phase F.4 (SEO audit) — added `openGraph.type`/`siteName`/`images`
// and a `twitter` card block, both previously entirely absent. The
// image is the real logo asset (not a fabricated marketing image); no
// dedicated OG-sized (1200×630) asset exists in this sandbox, so the
// logo is reused honestly rather than inventing a path to an image
// that doesn't exist. `twitter.card` is "summary" (not
// "summary_large_image") for the same reason — that variant expects a
// wide (1.91:1) image, and the logo is square, not wide.
//
// Brand Identity Reset (2026-07) — Phase 1: image path updated to the
// new official asset (public/Barqlogo.png, 2000×2000 — the same
// reasoning as above still applies, still square, still not a
// dedicated OG crop).
export function buildLocalizedMetadata({ locale, pathname, title, description, images }: LocalizedMetadataInput): Metadata {
  const languageAlternates: Record<string, string> = Object.fromEntries(
    locales.map((code) => [code, `/${code}${pathname}`])
  );
  languageAlternates["x-default"] = `/${defaultLocale}${pathname}`;

  const resolvedImages = images ?? ["/Barqlogo.png"];

  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${pathname}`,
      languages: languageAlternates,
    },
    openGraph: {
      title,
      description,
      locale: openGraphLocales[locale],
      type: "website",
      siteName: "BARQ",
      images: resolvedImages,
    },
    twitter: {
      // Phase F.4's own reasoning (square logo, not a 1.91:1 crop) only
      // applies to the shared static logo — a caller overriding
      // `images` with a real 1200×630 opengraph-image.tsx render can
      // safely use the wide card variant.
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      images: resolvedImages,
    },
    other: {
      "current-locale": locale,
    },
  };
}
