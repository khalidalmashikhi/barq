import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import {
  getServiceForPreview,
  getRelatedServices,
  getProviderPublishedServicesCount,
  getReviewsForService,
  getServiceRatingAggregate,
} from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { ServiceDetailView } from "@/components/services/service-detail-view";
import { PreviewBanner } from "@/components/preview/preview-banner";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildPublicUrl } from "@/lib/seo/build-public-url";

// Provider service preview — Unified Preview System. Lets a provider see their
// OWN service (including DRAFT/PAUSED/unpublished) exactly as customers will,
// via the shared ServiceDetailView, before publishing.
//
// SECURITY: server-side only. requireProvider() authenticates; ownership is
// then re-derived from the DB (service.providerId === the caller's provider)
// and a mismatch OR a missing service returns the SAME uniform 404 — never a
// 403 — so this can't be used to probe which service ids exist or belong to
// whom (mirrors getBookingDetail()'s existing pattern). noindex + auth-gated
// (dynamic, never statically cached) + absent from the sitemap.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function ProviderServicePreviewPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();

  let providerId: string;
  try {
    providerId = (await requireProvider()).provider.id;
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw err;
  }

  const service = await getServiceForPreview(id);
  if (!service || service.providerId !== providerId) {
    notFound();
    return null;
  }

  const [relatedServices, slots, providerPublishedServicesCount, reviews, ratingAggregate] = await Promise.all([
    getRelatedServices(service.id, service.providerId),
    getAvailableSlots(service.id),
    getProviderPublishedServicesCount(service.providerId),
    getReviewsForService(service.id),
    getServiceRatingAggregate(service.id),
  ]);

  const t = await getServerTranslator("provider");
  const serviceUrl = buildPublicUrl(locale, `/services/${service.id}`);

  return (
    <div className="flex min-h-screen flex-col">
      <PreviewBanner title={t("previewServiceBannerTitle")} description={t("previewServiceBannerDescription")} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <ServiceDetailView
          service={service}
          relatedServices={relatedServices}
          slots={slots}
          providerPublishedServicesCount={providerPublishedServicesCount}
          reviews={reviews}
          ratingAggregate={ratingAggregate}
          serviceUrl={serviceUrl}
          mode="provider-preview"
        />
      </main>
    </div>
  );
}
