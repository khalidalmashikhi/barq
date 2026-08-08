import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getCategoryPreview } from "@/lib/categories/get-category-preview";
import {
  getCategoryVisibilityStyle,
  getCategoryVisibilityTranslationKey,
} from "@/lib/categories/presentation/category-visibility";
import { CategoryDiscoveryCard } from "@/components/categories/category-discovery-card";
import { PreviewBanner } from "@/components/preview/preview-banner";
import { Card } from "@/components/ui/card";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { isValidUuid } from "@/lib/uuid";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Admin category preview — Unified Preview System. Shows how a category would
// appear in customer-facing discovery (the shared CategoryDiscoveryCard) plus
// the context an admin needs before making it public: parent/breadcrumb,
// visibility status, EFFECTIVE visibility (reusing the existing policy),
// ordering among siblings, and linked published-service count. Admin-gated
// (getCategoryPreview -> requireAdmin), noindex, absent from the sitemap.
// There is no category description/icon column, so none is shown (not invented).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

export default async function AdminCategoryPreviewPage({ params }: Props) {
  const { id } = await params;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let category;
  try {
    category = await getCategoryPreview(id);
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

  if (!category) {
    notFound();
  }

  const label = extractLocalizedText(category.name, locale) || category.name.en;
  const parentLabel = category.parent
    ? extractLocalizedText(category.parent.name, locale) || category.parent.name.en
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <PreviewBanner title={t("previewCategoryBannerTitle")} description={t("previewCategoryBannerDescription")} />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-8">
        <Link
          href={`/admin/categories/${id}`}
          className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
        >
          <ArrowRight size={16} strokeWidth={1.75} />
          {t("previewBackLabel")}
        </Link>

        {/* Parent -> this breadcrumb (as customer-facing discovery would nest it) */}
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-foreground/50">
          {parentLabel && (
            <>
              <span>{parentLabel}</span>
              <ArrowRight size={12} strokeWidth={1.75} className="rtl:rotate-180" />
            </>
          )}
          <span className="font-medium text-foreground">{label}</span>
        </nav>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">{t("previewDiscoveryCardHeading")}</h2>
          <div className="w-40">
            {/* Same customer-facing card as the homepage discovery grid; not
                interactive here since a non-public category has no live
                discovery destination yet. */}
            <CategoryDiscoveryCard slug={category.slug} label={label} interactive={false} />
          </div>
        </div>

        <Card hoverLift={false}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-foreground/40">{t("previewVisibilityLabel")}</dt>
              <dd className="mt-1">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${getCategoryVisibilityStyle(
                    category.visibilityStatus as CategoryVisibilityStatus
                  )}`}
                >
                  {t(getCategoryVisibilityTranslationKey(category.visibilityStatus as CategoryVisibilityStatus))}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/40">{t("previewEffectiveVisibilityLabel")}</dt>
              <dd className="mt-1 text-sm text-foreground">
                {category.effectivelyVisible ? t("previewEffectivelyVisibleYes") : t("previewEffectivelyVisibleNo")}
                {!category.effectivelyVisible && category.visibilityStatus === "PUBLIC" && category.parent && (
                  <span className="ms-1 text-xs text-foreground/40">{t("hiddenByParentLabel")}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/40">{t("previewOrderingLabel")}</dt>
              <dd className="mt-1 text-sm text-foreground">
                {t("previewOrderingValue", { position: category.sortOrder + 1, total: category.siblingCount })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/40">{t("previewLinkedServicesLabel")}</dt>
              <dd className="mt-1 text-sm text-foreground">
                {t("previewLinkedServicesValue", { count: category.linkedPublishedServiceCount })}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
