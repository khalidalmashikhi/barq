import type { Metadata } from "next";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { LegalSection } from "@/components/layout/legal-section";
import { Alert } from "@/components/ui/alert";

// Cookie Policy — Phase F.4 (goal 7, Legal Pages). Same shell-only
// discipline as terms/page.tsx — see that file's comment. Note: no
// cookie-consent banner or cookie-category toggles exist anywhere in
// this app (confirmed by grep) — this page describes the topics a
// cookie policy covers, it does not claim any consent-management tool
// is active.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/cookies",
    title: tSeo("pageTitleTemplate", { page: tPages("cookies.title"), appName: tCommon("appName") }),
    description: tSeo("legalCookiesDescription"),
  });
}

export default async function CookiesPage() {
  const t = await getServerTranslator("pages");

  const sections = ["whatAreCookies", "howWeUseCookies", "managingCookies"] as const;

  return (
    <StaticPageLayout title={t("cookies.title")} subtitle={t("legal.lastUpdatedPlaceholder")} maxWidthClassName="max-w-2xl">
      <Alert variant="info">{t("legal.placeholderNotice")}</Alert>
      <div className="flex flex-col gap-6">
        {sections.map((key) => (
          <LegalSection key={key} title={t(`cookies.section.${key}Title`)}>
            {t("legal.sectionPlaceholderBody")}
          </LegalSection>
        ))}
      </div>
    </StaticPageLayout>
  );
}
