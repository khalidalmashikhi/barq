import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { applyAsProvider } from "@/lib/provider/apply-as-provider";
import { isProviderApplicationErrorCode, getProviderApplicationErrorTranslationKey } from "@/lib/provider/provider-application-errors";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import type { ProviderStatus } from "@prisma/client";

// Provider Application — Phase 5.1 (Production Readiness: self-service
// signup). Deliberately OUTSIDE the /provider/* route tree, which is
// gated by requireProvider() and therefore unreachable for any user who
// doesn't already have a Provider profile — the exact chicken-and-egg
// gap this page exists to close. Gated only by requireAuth(): any
// authenticated User (bare, Customer, or an existing Provider checking
// their own status) can reach it.
//
// businessName is the only required field beyond userId anywhere on
// Provider (no license/document/KYC field exists in this schema) — this
// form collects exactly that, nothing fabricated.
//
// A new application is created with status "APPLIED" (the schema
// default, set explicitly for clarity in apply-as-provider.ts) — the
// exact status get-pending-providers.ts already queries for, so it
// appears in the existing admin approval queue unmodified.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const STATUS_LABEL_KEYS = {
  APPLIED: "applicationStatusApplied",
  UNDER_REVIEW: "applicationStatusUnderReview",
  APPROVED: "applicationStatusApproved",
  SUSPENDED: "applicationStatusSuspended",
  DEACTIVATED: "applicationStatusDeactivated",
} as const satisfies Record<ProviderStatus, string>;

type Props = { searchParams: Promise<{ error?: string }> };

export default async function ProviderApplicationPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const locale = await getLocale();
  const t = await getServerTranslator("provider");

  let barqUserId: string;
  try {
    const auth = await requireAuth();
    barqUserId = auth.barqUser.id;
  } catch (authError) {
    if (authError instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw authError;
  }

  const existingProvider = await prisma.provider.findUnique({
    where: { userId: barqUserId },
    select: { businessName: true, status: true },
  });

  const errorMessage =
    error && isProviderApplicationErrorCode(error) ? t(getProviderApplicationErrorTranslationKey(error)) : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t("applicationTitle")}</h1>
      <p className="text-sm text-foreground/60">{t("applicationSubtitle")}</p>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      {existingProvider ? (
        <Card hoverLift={false}>
          <div className="flex flex-col gap-2 p-2">
            <p className="text-sm font-medium text-foreground">{extractLocalizedText(existingProvider.businessName, locale)}</p>
            <p className="text-sm text-foreground/60">
              {t("applicationStatusLabel")}: {t(STATUS_LABEL_KEYS[existingProvider.status])}
            </p>
          </div>
        </Card>
      ) : (
        <Card hoverLift={false}>
          <form
            action={async (formData: FormData) => {
              "use server";
              const result = await applyAsProvider(formData);
              if (!result.ok) {
                redirect({ href: `/provider-application?error=${result.error}`, locale });
                return;
              }
              redirect({ href: "/provider-application", locale });
            }}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("businessNameArLabel")}</span>
                <input
                  type="text"
                  name="businessNameAr"
                  required
                  dir="rtl"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("businessNameEnLabel")}</span>
                <input
                  type="text"
                  name="businessNameEn"
                  required
                  dir="ltr"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("businessDescriptionArLabel")}</span>
                <textarea
                  name="businessDescriptionAr"
                  rows={3}
                  dir="rtl"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("businessDescriptionEnLabel")}</span>
                <textarea
                  name="businessDescriptionEn"
                  rows={3}
                  dir="ltr"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>

            <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("applicationSubmitButton")}
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
