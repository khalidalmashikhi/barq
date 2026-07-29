import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Sans } from "next/font/google";
import { getLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { MotionConfig } from "framer-motion";
import { getLocaleDirection, type Locale } from "@/i18n/locales";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { SkipLink } from "@/components/ui/skip-link";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import "./globals.css";

// This root layout sets `lang`/`dir` dynamically via next-intl's
// getLocale() (BARQ Internationalization, Phase 0) instead of the
// hardcoded lang="ar" dir="rtl" it previously carried. Behavior is
// UNCHANGED for every existing, not-yet-migrated route: none of them
// are under the new [locale] segment or matched by middleware.ts in
// this phase, so getLocale() resolves to routing.defaultLocale
// ("ar") for all of them — exactly the value that was hardcoded
// before. Only the new /ar, /en, ... validation routes (Phase 0
// infrastructure-only) actually vary this attribute today. Full
// locale negotiation (stored user preference → request-level
// negotiation → Arabic default), per LOCALIZATION.md §3, remains a
// later-phase concern — this file does not implement that chain,
// only reads whatever locale next-intl's request config already
// resolved for the current request.
//
// Typography: IBM Plex Sans Arabic (Arabic) + IBM Plex Sans (Latin) — a
// genuinely matched pairing from the same type family, per the visual
// identity brief's "Tajawal or IBM Plex Sans Arabic" choice, resolved in
// tailwind.config.ts's comment. Both loaded via next/font/google, which
// self-hosts at build time (no runtime request to Google's CDN, no
// layout shift from a late-loading web font). Subset expansion for the
// other 6 target locales (cyrillic for Russian, latin-ext for
// Polish/Czech) is later-phase work, not needed while only Arabic/
// English content actually renders.
//
// NextIntlClientProvider (Phase A.1): now mounted here, at the TRUE
// root layout, not only inside src/app/[locale]/layout.tsx's
// validation-only subtree — this is what makes useTranslations()
// callable from ANY Client Component in the real, currently-served
// app tree, not just the Phase 0 validation routes. No props are
// passed (locale/messages/etc. are all auto-received from the current
// request's context, since this is itself a Server Component — see
// next-intl's own NextIntlClientProviderServer), so this resolves
// identically to how getLocale() already does two lines below: "ar"
// for every existing, not-yet-migrated route, the real per-segment
// locale for anything under [locale]. src/app/[locale]/layout.tsx's
// OWN NextIntlClientProvider was removed in this same change to avoid
// a nested/duplicate provider now that the root supplies one — every
// other Phase 0 file (routing.ts, request.ts, locales.ts,
// middleware.ts, get-server-translator.ts) is unchanged.

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

const plexLatin = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-latin",
  display: "swap",
});

// Phase B Group 5 — SEO/hreflang: metadataBase is set here, once, at
// the true root of the metadata tree. Every descendant route's
// relative `alternates.canonical`/`alternates.languages` values
// (src/lib/i18n/metadata.ts) resolve against this base automatically,
// per Next.js's Metadata API — no route needs to repeat it. No
// NEXT_PUBLIC_APP_URL was previously defined anywhere in this project
// (verified: absent from .env.example and every env-reading source
// file); the localhost fallback keeps local dev/build working without
// requiring it to be set, matching how DATABASE_URL etc. are already
// documented as required-but-locally-defaulted in this codebase.
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");

  return {
    metadataBase: new URL(appUrl),
    title: tCommon("appName"),
    description: tSeo("defaultDescription"),
  };
}

// Phase F.4 (SEO audit) — a real, minimal Organization JSON-LD: name,
// url, and logo only. No aggregateRating/review/founder/contactPoint
// fields — none of that data exists anywhere in this codebase, and
// schema.org content must never be fabricated. This is genuinely new
// structured data (grepped `application/ld+json`/`@context`/
// `schema.org` across the whole codebase beforehand — zero prior
// matches), added once at the root so it applies to every page.
//
// Brand Identity Reset (2026-07) — Phase 1: logo now points at the new
// official asset (public/Barqlogo.png), used exactly as supplied — no
// cropping/resizing here, unlike the favicon set, since a JSON-LD logo
// field has no small-size legibility constraint.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "BARQ",
  url: appUrl,
  logo: `${appUrl}/Barqlogo.png`,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;
  const direction = getLocaleDirection(locale);

  return (
    <html lang={locale} dir={direction} className={`${plexArabic.variable} ${plexLatin.variable}`}>
      <body className="font-sans antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(organizationJsonLd) }} />
        <NextIntlClientProvider>
          <SkipLink />
          <OfflineBanner />
          {/* Phase 3 Wave 1: FadeIn/ExperienceCard drive their entrance
              and hover motion via framer-motion's own RAF/WAAPI engine,
              which the CSS-level prefers-reduced-motion handling in
              globals.css cannot reach. MotionConfig is framer-motion's
              own mechanism for honoring the OS setting — reducedMotion
              ="user" disables all animation for users who request it. */}
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
