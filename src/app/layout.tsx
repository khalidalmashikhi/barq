import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Sans } from "next/font/google";
import { getLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocaleDirection, type Locale } from "@/i18n/locales";
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

export const metadata: Metadata = {
  title: "BARQ",
  description: "BARQ — Smart Tourism Operations Platform",
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
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
