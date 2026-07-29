import type { Metadata } from "next";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { LegalSection } from "@/components/layout/legal-section";
import { Alert } from "@/components/ui/alert";

// Privacy Policy — Phase F.4 (goal 7, Legal Pages). Same shell-only
// discipline as terms/page.tsx — see that file's comment.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/privacy",
    title: tSeo("pageTitleTemplate", { page: tPages("privacy.title"), appName: tCommon("appName") }),
    description: tSeo("legalPrivacyDescription"),
  });
}

export default async function PrivacyPage() {
  const t = await getServerTranslator("pages");

  const sections = ["informationCollected", "howWeUseIt", "dataSharing", "dataRetention", "yourRights"] as const;

  return (
    <StaticPageLayout title={t("privacy.title")} subtitle={t("legal.lastUpdatedPlaceholder")} maxWidthClassName="max-w-2xl">
      <Alert variant="info">{t("legal.placeholderNotice")}</Alert>
      <div className="flex flex-col gap-6">
        {sections.map((key) => (
          <LegalSection key={key} title={t(`privacy.section.${key}Title`)}>
            {t("legal.sectionPlaceholderBody")}
          </LegalSection>
        ))}
      </div>
    </StaticPageLayout>
  );
}
