import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProviderProfile } from "@/lib/services/get-provider-profile";
import { getServices } from "@/lib/services/get-services";
import { ProviderProfileView } from "@/components/providers/provider-profile-view";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { buildBreadcrumbListJsonLd, buildProviderLocalBusinessJsonLd } from "@/lib/seo/structured-data";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

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
        <ProviderProfileView
          provider={provider}
          services={{ items: result.items, page: result.page, totalPages: result.totalPages }}
          basePath={basePath}
          providerUrl={providerUrl}
          page={page}
          mode="public"
        />
      </main>
      <Footer />
    </div>
  );
}
