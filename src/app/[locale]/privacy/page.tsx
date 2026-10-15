import type { Metadata } from "next";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { LegalSection } from "@/components/layout/legal-section";
import { Alert } from "@/components/ui/alert";

// Privacy Policy — Phase F.4 (goal 7, Legal Pages). Same shell-only
// discipline as terms/page.tsx — see that file's comment.
//
// 2026-10-16 — the "automatic reading of vehicle registration documents" section is REAL content, not a
// placeholder: it carries, verbatim, the disclosure the provider's consent step used to show inline (who
// processes the document, what is sent, where it is processed, purpose, accuracy, declining, retention,
// what is recorded). The consent step now links here (#automatic-reading) and keeps only a short neutral
// sentence. The geography sentence is the broader one ("outside Oman … the United States or other
// countries"), true for every configured region — so this public page never imports the reader factory.
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
  const reading = ["processor", "processorPdf", "processorImages", "geoGlobal", "purpose", "accuracy", "decline", "retention", "limits", "recorded"] as const;

  return (
    <StaticPageLayout title={t("privacy.title")} subtitle={t("legal.lastUpdatedPlaceholder")} maxWidthClassName="max-w-2xl">
      <Alert variant="info">{t("legal.placeholderNotice")}</Alert>
      <div className="flex flex-col gap-6">
        <section id="automatic-reading" className="flex scroll-mt-24 flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("privacy.automaticReading.title")}</h2>
          <ul className="flex list-disc flex-col gap-2 ps-5 text-sm leading-relaxed text-foreground/80">
            {reading.map((key) => (
              <li key={key}>{t(`privacy.automaticReading.${key}`)}</li>
            ))}
          </ul>
        </section>
        {sections.map((key) => (
          <LegalSection key={key} title={t(`privacy.section.${key}Title`)}>
            {t("legal.sectionPlaceholderBody")}
          </LegalSection>
        ))}
      </div>
    </StaticPageLayout>
  );
}
