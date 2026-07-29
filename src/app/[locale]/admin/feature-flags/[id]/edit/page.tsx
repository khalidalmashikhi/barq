import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { getFeatureFlagDetail } from "@/lib/feature-flags/get-feature-flag-detail";
import { updateFeatureFlag } from "@/lib/feature-flags/update-feature-flag";
import { enableFeatureFlag, disableFeatureFlag } from "@/lib/feature-flags/toggle-feature-flag";
import { isFeatureFlagActionErrorCode, getFeatureFlagErrorTranslationKey } from "@/lib/feature-flags/feature-flag-errors";
import { isValidUuid } from "@/lib/uuid";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Edit Feature Flag — Phase 1.3 (Core Business Platform). Mirrors
// admin/categories/[id]/edit/page.tsx's shape, plus the enable/disable
// quick action inline (mirroring the list row's own toggle) since there's
// no separate detail page for a flag — its "detail" and "edit" are the
// same screen, unlike Category (which has a distinct nested-subcategory
// detail view justifying a separate page).

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditFeatureFlagPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  if (!isValidUuid(id)) {
    notFound();
  }

  let flag;
  try {
    flag = await getFeatureFlagDetail(id);
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

  if (!flag) {
    notFound();
  }

  const errorMessage = error && isFeatureFlagActionErrorCode(error) ? t(getFeatureFlagErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/feature-flags" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToFeatureFlagsLabel")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-mono text-2xl font-semibold text-foreground">{flag.key}</h1>
        <Badge variant={flag.enabled ? "success" : "default"}>
          {flag.enabled ? t("featureFlagEnabledLabel") : t("featureFlagDisabledLabel")}
        </Badge>
      </div>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async () => {
            "use server";
            const result = flag.enabled ? await disableFeatureFlag(id) : await enableFeatureFlag(id);
            if (!result.ok) {
              redirect({ href: `/admin/feature-flags/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: `/admin/feature-flags/${id}/edit`, locale });
          }}
        >
          <SubmitButton className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
            {flag.enabled ? t("disableFeatureFlagButton") : t("enableFeatureFlagButton")}
          </SubmitButton>
        </form>
      </Card>

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await updateFeatureFlag(id, formData);
            if (!result.ok) {
              redirect({ href: `/admin/feature-flags/${id}/edit?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/admin/feature-flags", locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("featureFlagDescriptionLabel")}</span>
            <textarea
              name="description"
              rows={3}
              dir="ltr"
              defaultValue={flag.description ?? ""}
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
