import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getHomepageSectionDetail } from "@/lib/homepage/get-homepage-section-detail";
import { updateHomepageSection } from "@/lib/homepage/update-homepage-section";
import { showHomepageSection, hideHomepageSection } from "@/lib/homepage/toggle-homepage-section";
import { isHomepageSectionActionErrorCode, getHomepageSectionErrorTranslationKey } from "@/lib/homepage/homepage-section-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Edit Homepage Section — Phase 1.4 (Core Business Platform). Mirrors
// admin/feature-flags/[id]/edit/page.tsx's shape exactly: combined
// detail+edit screen with the show/hide quick action inline, plus a
// separate label/description form — no nested child entity here, unlike
// Category.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditHomepageSectionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let section;
  try {
    section = await getHomepageSectionDetail(id);
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

  if (!section) {
    notFound();
  }

  const errorMessage = error && isHomepageSectionActionErrorCode(error) ? t(getHomepageSectionErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/homepage-sections" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToHomepageSectionsLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{section.label}</h1>
          <p className="mt-0.5 font-mono text-xs text-foreground/40">{section.key}</p>
        </div>
        <Badge variant={section.visible ? "success" : "default"}>
          {section.visible ? t("homepageSectionVisibleLabel") : t("homepageSectionHiddenLabel")}
        </Badge>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async () => {
            "use server";
            const result = section.visible ? await hideHomepageSection(id) : await showHomepageSection(id);
            if (!result.ok) {
              redirect({ href: `/admin/homepage-sections/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/homepage-sections/${id}/edit`, locale });
          }}
        >
          <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
            {section.visible ? t("hideHomepageSectionButton") : t("showHomepageSectionButton")}
          </SubmitButton>
        </form>
      </Card>

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateHomepageSection(id, formData);
            if (!result.ok) {
              redirect({ href: `/admin/homepage-sections/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/admin/homepage-sections", locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("homepageSectionLabelLabel")}</span>
            <input
              type="text"
              name="label"
              required
              defaultValue={section.label}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("homepageSectionDescriptionLabel")}</span>
            <textarea
              name="description"
              rows={3}
              dir="ltr"
              defaultValue={section.description ?? ""}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("saveChangesButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
