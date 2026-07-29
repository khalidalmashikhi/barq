import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BadgeCheck, MapPin, Package, Star, PackageOpen, Share2 } from "lucide-react";
import { getProviderProfile } from "@/lib/services/get-provider-profile";
import { getServices } from "@/lib/services/get-services";
import { ExperienceCard } from "@/components/dashboard/experience-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ShareButton } from "@/components/ui/share-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { buildBreadcrumbListJsonLd, buildProviderLocalBusinessJsonLd } from "@/lib/seo/structured-data";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { FadeIn } from "@/components/ui/fade-in";
import { Badge } from "@/components/ui/badge";

// Public provider profile (storefront) — Marketplace Completion.
//
// Closes a genuine structural gap confirmed before writing any code: no
// customer-facing page previously existed anywhere that let a visitor
// browse all of one provider's services together. Everything this page
// renders is real, existing data (Provider.businessName/
// businessDescription/city/logoUrl, Provider.status/visible gating,
// Service.providerId, Review.providerId's own documented aggregate-
// rating purpose) — no schema change, per this task's explicit
// constraint.

type Props = { params: Promise<{ idOrSlug: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { idOrSlug } = await params;
  const provider = await getProviderProfile(idOrSlug);
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const locale = await getLocale();

  if (!provider) {
    // Mirrors services/[id]/page.tsx's own not-found metadata pattern:
    // no canonical/hreflang for a nonexistent provider, no explicit
    // `robots` field — Next emits its own noindex once notFound() fires.
    return {
      title: tSeo("pageTitleTemplate", { page: tSeo("providerNotFoundTitle"), appName: tCommon("appName") }),
    };
  }

  return buildLocalizedMetadata({
    locale,
    pathname: `/providers/${idOrSlug}`,
    title: tSeo("pageTitleTemplate", { page: provider.name, appName: tCommon("appName") }),
    description:
      provider.description ||
      tSeo("providerDescriptionFallback", { providerName: provider.name, appName: tCommon("appName") }),
    // Growth Foundations phase — points Open Graph/Twitter at this
    // page's own dynamic opengraph-image.tsx route instead of the
    // shared static logo every other page still uses.
    images: [buildPublicUrl(locale, `/providers/${idOrSlug}/opengraph-image`)],
  });
}

export default async function ProviderProfilePage({ params, searchParams }: Props) {
  const { idOrSlug } = await params;
  const { page } = await searchParams;

  const provider = await getProviderProfile(idOrSlug);
  if (!provider) {
    notFound();
    return null;
  }

  const locale = await getLocale();
  const basePath = getPathname({ href: `/providers/${idOrSlug}`, locale });

  const result = await getServices({
    providerId: provider.id,
    page: page ? Number(page) : 1,
  });

  const t = await getServerTranslator("services");
  const initial = provider.name.trim().charAt(0) || "?";

  // Growth Foundations phase — structured data from real, already-
  // fetched fields only. logoUrl/city/averageRating/reviewCount are
  // omitted from the JSON-LD entirely (not defaulted) whenever null,
  // per buildProviderLocalBusinessJsonLd()'s own truthful-by-construction
  // contract.
  const providerUrl = buildPublicUrl(locale, `/providers/${idOrSlug}`);
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: t("title"), url: buildPublicUrl(locale, "/services") },
    { name: provider.name, url: providerUrl },
  ]);
  const localBusinessJsonLd = buildProviderLocalBusinessJsonLd({
    name: provider.name,
    description: provider.description || undefined,
    url: providerUrl,
    image: provider.logoUrl || undefined,
    city: provider.city || undefined,
    ratingValue: provider.averageRating ?? undefined,
    ratingCount: provider.reviewCount,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(localBusinessJsonLd) }} />
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <FadeIn className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {provider.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider.logoUrl is a plain reference URL, no next/image remotePatterns configured for arbitrary provider-supplied hosts.
              <img
                src={provider.logoUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-xl font-semibold text-white">
                {initial}
              </span>
            )}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{provider.name}</h1>
                <Badge variant="info" className="gap-1">
                  <BadgeCheck size={13} strokeWidth={2} />
                  {t("verifiedProviderLabel")}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/50">
                <span className="flex items-center gap-1.5">
                  <Package size={13} strokeWidth={1.75} />
                  {t("experiencesCountLabel", { count: provider.publishedServicesCount })}
                </span>
                {provider.city && (
                  <span className="flex items-center gap-1.5">
                    <MapPin size={13} strokeWidth={1.75} />
                    {provider.city}
                  </span>
                )}
                {provider.reviewCount > 0 && provider.averageRating !== null && (
                  <span className="flex items-center gap-1.5">
                    <Star size={13} strokeWidth={1.75} className="text-accent" fill="currentColor" />
                    {t("providerRatingLabel", { rating: provider.averageRating.toFixed(1), count: provider.reviewCount })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {provider.description && (
            <p className="mt-4 text-sm leading-relaxed text-foreground/70">{provider.description}</p>
          )}

          <div className="mt-4">
            <ShareButton
              url={providerUrl}
              title={provider.name}
              text={t("shareProviderText", { providerName: provider.name })}
              label={t("shareLabel")}
              copiedLabel={t("shareCopiedLabel")}
              errorLabel={t("shareErrorLabel")}
              icon={<Share2 size={14} strokeWidth={1.75} />}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20"
            />
          </div>
        </FadeIn>

        {result.items.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            iconSize={32}
            gap="gap-3"
            padding="py-16"
            message={t("providerNoServicesLabel")}
            messageClassName="text-foreground/60"
          />
        ) : (
          <FadeIn delay={0.05} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((service) => (
              <ExperienceCard
                key={service.id}
                serviceId={service.id}
                title={service.name}
                providerName={service.providerName}
                price={service.price}
                imageAspect="premium"
              />
            ))}
          </FadeIn>
        )}

        <Pagination page={result.page} totalPages={result.totalPages} searchParams={{ page }} basePath={basePath} />
      </main>
      <Footer />
    </div>
  );
}
