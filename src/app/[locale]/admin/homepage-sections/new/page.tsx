import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createHomepageSection } from "@/lib/homepage/create-homepage-section";
import { isHomepageSectionActionErrorCode, getHomepageSectionErrorTranslationKey } from "@/lib/homepage/homepage-section-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Homepage Section — Phase 1.4 (Core Business Platform). Mirrors
// admin/feature-flags/new/page.tsx's form shape.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewHomepageSectionPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isHomepageSectionActionErrorCode(error) ? t(getHomepageSectionErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/homepage-sections" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToHomepageSectionsLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createHomepageSectionTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createHomepageSection(formData);
            if (!result.ok) {
              redirect({ href: `/admin/homepage-sections/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/admin/homepage-sections", locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("homepageSectionKeyLabel")}</span>
            <input
              type="text"
              name="key"
              required
              pattern="[a-z][a-z0-9_]*"
              placeholder="hero_banner"
              dir="ltr"
              className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("homepageSectionKeyHintLabel")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("homepageSectionLabelLabel")}</span>
            <input
              type="text"
              name="label"
              required
              placeholder="Hero Banner"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("homepageSectionDescriptionLabel")}</span>
            <textarea
              name="description"
              rows={3}
              dir="ltr"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createHomepageSectionSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
