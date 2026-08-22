import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getServiceById,
  getRelatedServices,
  getProviderPublishedServicesCount,
  getReviewsForService,
  getServiceRatingAggregate,
} from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { getPublicTourVehicleSummary } from "@/lib/tour-template/vehicle-pool/public-tour-vehicles";
import { ServiceDetailView } from "@/components/services/service-detail-view";
import { TourVehicleSection } from "@/components/tour-template/tour-vehicle-section";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { buildPublicUrl } from "@/lib/seo/build-public-url";
import { buildBreadcrumbListJsonLd, buildServiceProductJsonLd } from "@/lib/seo/structured-data";
import { toSafeJsonLdString } from "@/lib/seo/safe-json-ld";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const service = await getServiceById(id);
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const locale = await getLocale();

  if (!service) {
    // Phase B Group 5 — SEO/hreflang: a nonexistent service gets no
    // canonical and no hreflang alternates (there is nothing for those
    // to correctly point to). No explicit `robots` field either —
    // Next.js already emits its own `noindex` meta tag automatically
    // whenever a route calls notFound() (verified empirically: adding
    // one here produced two separate <meta name="robots"> tags, not
    // one merged value).
    return {
      title: tSeo("pageTitleTemplate", { page: tSeo("serviceNotFoundTitle"), appName: tCommon("appName") }),
    };
  }

  return buildLocalizedMetadata({
    locale,
    pathname: `/services/${id}`,
    title: tSeo("pageTitleTemplate", { page: service.name, appName: tCommon("appName") }),
    description: service.description || tSeo("serviceDescriptionFallback", {
      serviceName: service.name, providerName: service.providerName, appName: tCommon("appName"),
    }),
    // Growth Foundations phase — points Open Graph/Twitter at this
    // page's own dynamic opengraph-image.tsx route instead of the
    // shared static logo every other page still uses.
    images: [buildPublicUrl(locale, `/services/${id}/opengraph-image`)],
  });
}

export default async function ServiceDetailPage({ params }: Props) {
  const { id } = await params;
  const fetchedService = await getServiceById(id);
  if (!fetchedService) { notFound(); return null; }
  const service = fetchedService;

  const [relatedServices, slots, providerPublishedServicesCount, reviews, ratingAggregate, tourVehicleSummary] = await Promise.all([
    getRelatedServices(service.id, service.providerId),
    getAvailableSlots(service.id),
    getProviderPublishedServicesCount(service.providerId),
    getReviewsForService(service.id),
    getServiceRatingAggregate(service.id),
    // TOUR-VEHICLE-3 — customer-safe tour vehicle summary (null for non-tour / GUIDE_ONLY).
    getPublicTourVehicleSummary(service.id),
  ]);

  const t = await getServerTranslator("services");
  const locale = await getLocale();

  // Growth Foundations phase — structured data built only from real,
  // already-fetched fields. `service.price` is the combined
  // "{amount} {currency}" string get-service-detail.ts already builds;
  // splitting it back into its two parts here is cheaper and safer than
  // adding a second, parallel raw-amount/currency field to that query's
  // return shape for this one consumer.
  const serviceUrl = buildPublicUrl(locale, `/services/${service.id}`);
  const [priceAmount, priceCurrency] = service.price?.split(" ") ?? [];
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: t("title"), url: buildPublicUrl(locale, "/services") },
    { name: service.name, url: serviceUrl },
  ]);
  const productJsonLd = buildServiceProductJsonLd({
    name: service.name,
    description: service.description || undefined,
    url: serviceUrl,
    priceAmount,
    priceCurrency,
    ratingValue: ratingAggregate.averageRating ?? undefined,
    ratingCount: ratingAggregate.reviewCount,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toSafeJsonLdString(productJsonLd) }} />
      <Navbar />
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <ServiceDetailView
          service={service}
          relatedServices={relatedServices}
          slots={slots}
          providerPublishedServicesCount={providerPublishedServicesCount}
          reviews={reviews}
          ratingAggregate={ratingAggregate}
          serviceUrl={serviceUrl}
          mode="public"
        />
        {/* TOUR-VEHICLE-3 — customer-safe tour vehicle presentation (tours with transport
            only). Composes the guidingContent promise with currently-eligible pooled
            vehicles; never an assigned/guaranteed vehicle. */}
        {tourVehicleSummary && <TourVehicleSection summary={tourVehicleSummary} />}
      </main>
      <Footer />
    </div>
  );
}
