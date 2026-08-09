import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, getPathname } from "@/i18n/navigation";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getProviderProfileForPreview } from "@/lib/services/get-provider-profile";
import { getProviderPublishedServicesForPreview } from "@/lib/services/get-provider-services-for-preview";
import { ProviderProfileView } from "@/components/providers/provider-profile-view";
import { PreviewBanner } from "@/components/preview/preview-banner";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildPublicUrl } from "@/lib/seo/build-public-url";

// Admin preview of a provider's public storefront — Unified Preview System.
//
// Lets an admin see EXACTLY what a provider's customer-facing storefront looks
// like before approving them (the gap: admin previously approved blind). RBAC:
// requireAdmin(). Previews ANY provider regardless of status/visibility via the
// ungated getProviderProfileForPreview. noindex + auth-gated + absent from the
// sitemap. No JSON-LD/canonical. ShareButton suppressed by mode. Services shown
// are PUBLISHED-only — no draft leakage (a pre-approval provider shows none).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };

export default async function AdminProviderPreviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { page } = await searchParams;
  const locale = await getLocale();

  try {
    await requireAdmin();
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

  const provider = await getProviderProfileForPreview(id);
  if (!provider) {
    notFound();
    return null;
  }

  const services = await getProviderPublishedServicesForPreview(id, page ? Number(page) : 1);
  const t = await getServerTranslator("admin");
  const basePath = getPathname({ href: `/admin/providers/${id}/preview`, locale });
  const providerUrl = buildPublicUrl(locale, `/providers/${id}`);

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
          mode="admin-preview"
        />
      </main>
    </div>
  );
}
