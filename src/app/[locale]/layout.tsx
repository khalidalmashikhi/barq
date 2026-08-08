import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { MotionConfig } from "framer-motion";
import { routing } from "@/i18n/routing";
import { getLocaleDirection, type Locale } from "@/i18n/locales";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { SkipLink } from "@/components/ui/skip-link";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import { plexArabic, plexLatin } from "../fonts";
import "../globals.css";

// [locale] layout — the TRUE per-request root of every real BARQ route (BARQ
// i18n stabilization). It now owns <html>/<body>, the fonts, document
// direction, the SEO metadata, and NextIntlClientProvider — all derived from
// the URL's `locale` param, the single source of truth. Because this layout
// lives AT the [locale] segment, it re-renders on every locale switch
// (including soft client navigations), so server text, client-component text,
// <html lang>, and dir all change together — no mixed-language UI, no stale
// provider. (These previously lived in the root layout above this segment,
// which does not re-render on a locale switch — see src/app/layout.tsx.)
//
// setRequestLocale(locale) is called in BOTH generateMetadata and the layout
// so next-intl's server APIs resolve the URL locale under static rendering.
// An invalid locale segment (/xyz) triggers notFound() — resolved by the
// root src/app/not-found.tsx (which renders its own <html>/<body>).

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (hasLocale(routing.locales, locale)) {
    setRequestLocale(locale);
  }

  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");

  return {
    metadataBase: new URL(appUrl),
    title: tCommon("appName"),
    description: tSeo("defaultDescription"),
  };
}

// Phase F.4 (SEO) — minimal Organization JSON-LD (name/url/logo only).
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "BARQ",
  url: appUrl,
  logo: `${appUrl}/Barqlogo.png`,
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const direction = getLocaleDirection(locale as Locale);

  return (
    <html lang={locale} dir={direction} className={`${plexArabic.variable} ${plexLatin.variable}`}>
      <body className="font-sans antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(organizationJsonLd) }} />
        {/* Explicit locale from the URL segment — keeps client-component
            messages/useLocale() in lockstep with server rendering and the
            document direction, and re-renders them on every locale switch. */}
        <NextIntlClientProvider locale={locale}>
          <SkipLink />
          <OfflineBanner />
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
