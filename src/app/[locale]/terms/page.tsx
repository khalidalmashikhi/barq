import type { Metadata } from "next";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { LegalSection } from "@/components/layout/legal-section";
import { Alert } from "@/components/ui/alert";

// Terms of Service — Phase F.4 (goal 7, Legal Pages). Per the explicit
// brief ("Do not write legal content. Create professional layouts."),
// this is a structural shell only: real section headings a Terms of
// Service would cover, each with an honest placeholder body — not
// fabricated binding legal text. The banner Alert makes this
// distinction explicit to any reader rather than silently presenting
// placeholder copy as though it were reviewed legal language.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/terms",
    title: tSeo("pageTitleTemplate", { page: tPages("terms.title"), appName: tCommon("appName") }),
    description: tSeo("legalTermsDescription"),
  });
}

export default async function TermsPage() {
  const t = await getServerTranslator("pages");

  const sections = ["acceptance", "usingPlatform", "bookingsAndPayments", "providerObligations", "liability", "changes"] as const;

  return (
    <StaticPageLayout title={t("terms.title")} subtitle={t("legal.lastUpdatedPlaceholder")} maxWidthClassName="max-w-2xl">
      <Alert variant="info">{t("legal.placeholderNotice")}</Alert>
      <div className="flex flex-col gap-6">
        {sections.map((key) => (
          <LegalSection key={key} title={t(`terms.section.${key}Title`)}>
            {t("legal.sectionPlaceholderBody")}
          </LegalSection>
        ))}
      </div>
    </StaticPageLayout>
  );
}
