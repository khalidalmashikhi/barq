import type { Metadata } from "next";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";
import { buildLocalizedMetadata } from "@/lib/i18n/metadata";
import { StaticPageLayout } from "@/components/layout/static-page-layout";
import { LegalSection } from "@/components/layout/legal-section";
import { Alert } from "@/components/ui/alert";

// Booking & Cancellation Policy — Phase F.4 (goal 7, Legal Pages).
// Unlike the other 3 legal pages, the "Cancellation Eligibility"
// section below states the REAL, already-implemented rule (from
// cancellation-policy.ts: cancellable only while CREATED or
// CONFIRMED) rather than a placeholder — that rule already exists and
// is enforced server-side, so restating it here is not fabrication.
// The remaining sections (payments, provider obligations, disputes)
// have no equivalent implemented business rule to cite, so they stay
// honest placeholders like the other legal pages.
export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getServerTranslator("common");
  const tSeo = await getServerTranslator("seo");
  const tPages = await getServerTranslator("pages");
  const locale = await getLocale();

  return buildLocalizedMetadata({
    locale,
    pathname: "/booking-policy",
    title: tSeo("pageTitleTemplate", { page: tPages("bookingPolicy.title"), appName: tCommon("appName") }),
    description: tSeo("legalBookingPolicyDescription"),
  });
}

export default async function BookingPolicyPage() {
  const t = await getServerTranslator("pages");

  const placeholderSections = ["payments", "providerObligations", "disputes"] as const;

  return (
    <StaticPageLayout title={t("bookingPolicy.title")} subtitle={t("legal.lastUpdatedPlaceholder")} maxWidthClassName="max-w-2xl">
      <Alert variant="info">{t("legal.placeholderNotice")}</Alert>
      <div className="flex flex-col gap-6">
        <LegalSection title={t("bookingPolicy.section.cancellationTitle")}>
          {t("bookingPolicy.section.cancellationBody")}
        </LegalSection>
        {placeholderSections.map((key) => (
          <LegalSection key={key} title={t(`bookingPolicy.section.${key}Title`)}>
            {t("legal.sectionPlaceholderBody")}
          </LegalSection>
        ))}
      </div>
    </StaticPageLayout>
  );
}
