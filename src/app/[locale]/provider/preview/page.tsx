import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, getPathname } from "@/i18n/navigation";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderProfileForPreview } from "@/lib/services/get-provider-profile";
import { getProviderPublishedServicesForPreview } from "@/lib/services/get-provider-services-for-preview";
import { ProviderProfileView } from "@/components/providers/provider-profile-view";
import { PreviewBanner } from "@/components/preview/preview-banner";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildPublicUrl } from "@/lib/seo/build-public-url";

// Provider self-preview of the public storefront — Unified Preview System.
//
// The provider id is derived from the AUTHENTICATED provider context
// (requireProvider), never from the URL, so a provider can only ever preview
// THEIR OWN storefront. requireProvider allows APPLIED/UNDER_REVIEW/APPROVED
// and blocks SUSPENDED/DEACTIVATED — exactly the states that may preview, with
// no ProviderStatus change. Works while visible=false (the read is ungated).
// noindex + auth-gated (dynamic, never cached) + absent from the sitemap. No
// JSON-LD/canonical. ShareButton is suppressed by mode. Services shown are
// PUBLISHED-only (getProviderPublishedServicesForPreview) — no draft leakage.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ page?: string }> };

export default async function ProviderProfilePreviewPage({ searchParams }: Props) {
  const { page } = await searchParams;
  const locale = await getLocale();

  let providerId: string;
  try {
    providerId = (await requireProvider()).provider.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (error instanceof ForbiddenError) {
      notFound();
      return null;
    }
    throw error;
  }

  const provider = await getProviderProfileForPreview(providerId);
  if (!provider) {
    notFound();
    return null;
  }

  const services = await getProviderPublishedServicesForPreview(providerId, page ? Number(page) : 1);
  const t = await getServerTranslator("provider");
  const basePath = getPathname({ href: "/provider/preview", locale });
  const providerUrl = buildPublicUrl(locale, `/providers/${providerId}`);

  return (
    <div className="flex min-h-screen flex-col">
      <PreviewBanner title={t("previewProfileBannerTitle")} description={t("previewProfileBannerDescription")} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
        <ProviderProfileView
          provider={provider}
          services={services}
          basePath={basePath}
          providerUrl={providerUrl}
          page={page}
          mode="provider-preview"
        />
      </main>
    </div>
  );
}
