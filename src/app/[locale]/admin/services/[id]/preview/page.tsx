import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
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

// Admin service preview — Unified Preview System. Lets an admin see any
// service (including unpublished) exactly as customers will, via the shared
// ServiceDetailView, before publishing. RBAC-gated (requireAdmin), noindex,
// auth-gated (dynamic, never statically cached), absent from the sitemap.
// Booking is suppressed (mode="admin-preview") — no customer booking flow or
// mutation is reachable.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function AdminServicePreviewPage({ params }: Props) {
  const { id } = await params;
  const locale = await getLocale();

  try {
    await requireAdmin();
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
  if (!service) {
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

  const t = await getServerTranslator("admin");
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
          mode="admin-preview"
        />
      </main>
    </div>
  );
}
