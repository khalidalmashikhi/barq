import type { Metadata } from "next";
import { Link, redirect } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { createFeatureFlag } from "@/lib/feature-flags/create-feature-flag";
import { isFeatureFlagActionErrorCode, getFeatureFlagErrorTranslationKey } from "@/lib/feature-flags/feature-flag-errors";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// Create Feature Flag — Phase 1.3 (Core Business Platform). Mirrors
// admin/categories/new/page.tsx's form shape.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function NewFeatureFlagPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getServerTranslator("admin");
  const locale = await getLocale();

  const errorMessage = error && isFeatureFlagActionErrorCode(error) ? t(getFeatureFlagErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <Link href="/admin/feature-flags" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} />
        {t("backToFeatureFlagsLabel")}
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">{t("createFeatureFlagTitle")}</h1>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      <Card hoverLift={false}>
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createFeatureFlag(formData);
            if (!result.ok) {
              redirect({ href: `/admin/feature-flags/new?error=${result.error}`, locale });
              return;
            }
            redirect({ href: "/admin/feature-flags", locale });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("featureFlagKeyLabel")}</span>
            <input
              type="text"
              name="key"
              required
              pattern="[a-z][a-z0-9_]*"
              placeholder="new_checkout_flow"
              dir="ltr"
              className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-foreground/40">{t("featureFlagKeyHintLabel")}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/50">{t("featureFlagDescriptionLabel")}</span>
            <textarea
              name="description"
              rows={3}
              dir="ltr"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
            {t("createFeatureFlagSubmitButton")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
