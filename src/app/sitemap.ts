import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { locales, defaultLocale, type Locale } from "@/i18n/locales";
import { getAppUrl } from "@/lib/seo/build-public-url";

// Dynamic sitemap — Growth Foundations phase.
//
// Closes the gap documented since Phase D.3 (robots.ts's own comment,
// docs/10-design/TRUST_AND_QUALITY.md, docs/11-release/RELEASE_CHECKLIST.md):
// no sitemap ever existed because a real one requires enumerating live,
// PUBLISHED Service ids and APPROVED+visible Provider ids from the
// database, not a static/guessed list — this is that enumeration.
//
// SCOPE, DELIBERATE: the static-page set below is exactly the set of
// pages that already call buildLocalizedMetadata() (src/lib/i18n/metadata.ts)
// today — the existing, already-decided "this page is indexable" boundary,
// not a new judgment call made here. Authenticated app-shell routes
// (admin/*, bookings*, dashboard, notifications, payments*, provider/*,
// reviews, provider-application's post-submit flow) are excluded exactly
// because none of them call buildLocalizedMetadata() and robots.ts already
// disallows most of them — this file never re-derives that boundary, it
// reuses it.
//
// PERFORMANCE: exactly two Prisma queries total (one for Service ids,
// one for Provider ids/slugs), regardless of locale count — the 8-locale
// fan-out happens in memory afterward, never as repeated queries.

const STATIC_PATHNAMES = [
  "",
  "/about",
  "/booking-policy",
  "/contact",
  "/cookies",
  "/help",
  "/help/booking",
  "/help/faq",
  "/help/provider",
  "/login",
  "/privacy",
  "/services",
  "/terms",
] as const;

function buildLanguageAlternates(pathname: string): Record<string, string> {
  const appUrl = getAppUrl();
  const languages: Record<string, string> = Object.fromEntries(
    locales.map((code) => [code, `${appUrl}/${code}${pathname}`])
  );
  languages["x-default"] = `${appUrl}/${defaultLocale}${pathname}`;
  return languages;
}

function buildEntriesForPathname(
  pathname: string,
  options?: { lastModified?: Date; changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"]; priority?: number }
): MetadataRoute.Sitemap {
  const appUrl = getAppUrl();
  const languages = buildLanguageAlternates(pathname);

  return locales.map((locale: Locale) => ({
    url: `${appUrl}/${locale}${pathname}`,
    lastModified: options?.lastModified,
    changeFrequency: options?.changeFrequency,
    priority: options?.priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [services, providers] = await Promise.all([
    prisma.service.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, updatedAt: true },
    }),
    prisma.provider.findMany({
      where: { status: "APPROVED", visible: true },
      select: { id: true, slug: true, updatedAt: true },
    }),
  ]);

  const staticEntries = STATIC_PATHNAMES.flatMap((pathname) =>
    buildEntriesForPathname(pathname, {
      changeFrequency: pathname === "" || pathname === "/services" ? "daily" : "monthly",
      priority: pathname === "" ? 1 : pathname === "/services" ? 0.8 : 0.5,
    })
  );

  const serviceEntries = services.flatMap((service) =>
    buildEntriesForPathname(`/services/${service.id}`, {
      lastModified: service.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    })
  );

  const providerEntries = providers.flatMap((provider) =>
    buildEntriesForPathname(`/providers/${provider.slug ?? provider.id}`, {
      lastModified: provider.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })
  );

  return [...staticEntries, ...serviceEntries, ...providerEntries];
}
