import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { redirect, Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { applyAsProvider } from "@/lib/provider/apply-as-provider";
import { resubmitProviderApplication } from "@/lib/provider/resubmit-provider-application";
import { assertProviderApprovable } from "@/lib/provider/documents/assert-provider-approvable";
import { isProviderApplicationErrorCode, getProviderApplicationErrorTranslationKey } from "@/lib/provider/provider-application-errors";
import { getSelectableCategories } from "@/lib/categories/get-selectable-categories";
import { DEFAULT_SERVICE_TYPE_KEY } from "@/lib/service-types";
import { ProviderCategoryChecklist } from "@/components/categories/provider-category-checklist";
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
  DRAFT: "applicationStatusDraft",
  APPLIED: "applicationStatusApplied",
  UNDER_REVIEW: "applicationStatusUnderReview",
  CHANGES_REQUESTED: "applicationStatusChangesRequested",
  APPROVED: "applicationStatusApproved",
  REJECTED: "applicationStatusRejected",
  SUSPENDED: "applicationStatusSuspended",
  DEACTIVATED: "applicationStatusDeactivated",
} as const satisfies Record<ProviderStatus, string>;

// Customer → Provider Journey (B) — per-status guidance so this page is the
// single source of truth for "what does my application status mean and what
// happens next", not just a bare label. UNDER_REVIEW has its own distinct
// message because the enum already exists and may be rendered — no transition
// INTO it is added in this batch. SUSPENDED/DEACTIVATED get accurate, neutral
// guidance only (no invented reason — there is no reason field in the data).
const STATUS_BODY_KEYS = {
  DRAFT: "applicationStatusDraftBody",
  APPLIED: "applicationStatusAppliedBody",
  UNDER_REVIEW: "applicationStatusUnderReviewBody",
  CHANGES_REQUESTED: "applicationStatusChangesRequestedBody",
  APPROVED: "applicationStatusApprovedBody",
  REJECTED: "applicationStatusRejectedBody",
  SUSPENDED: "applicationStatusSuspendedBody",
  DEACTIVATED: "applicationStatusDeactivatedBody",
} as const satisfies Record<ProviderStatus, string>;

// The states that are still "in the application journey" (not terminated) —
// these reassure the applicant that their customer account is unaffected.
// REJECTED is included: a rejected applicant remains a full customer and can
// correct + resubmit.
const REMAIN_CUSTOMER_STATUSES: ProviderStatus[] = [
  "DRAFT",
  "APPLIED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
];
const TERMINATED_STATUSES: ProviderStatus[] = ["SUSPENDED", "DEACTIVATED"];

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
    select: { id: true, businessName: true, status: true, rejectionReason: true },
  });

  // Verification & Documents (Gate 3) — surface a link to the verification page
  // when required documents are still incomplete (reuses the same approval-gate
  // primitive; this page never renders the document UI itself).
  const hasDocumentBlockers =
    existingProvider && ["APPLIED", "UNDER_REVIEW", "REJECTED"].includes(existingProvider.status)
      ? (await assertProviderApprovable(existingProvider.id)).length > 0
      : false;

  const errorMessage =
    error && isProviderApplicationErrorCode(error) ? t(getProviderApplicationErrorTranslationKey(error)) : null;

  // Areas of activity for the application form — real admin taxonomy, same
  // selectable set as Provider Settings (reused checklist + keys).
  const categoryTree = existingProvider ? null : await getSelectableCategories(DEFAULT_SERVICE_TYPE_KEY);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <h1 className="text-2xl font-semibold text-foreground">{t("applicationTitle")}</h1>
      <p className="text-sm text-foreground/60">{t("applicationSubtitle")}</p>

      {errorMessage && <Alert variant="danger">{errorMessage}</Alert>}

      {existingProvider ? (
        <Card hoverLift={false}>
          <div className="flex flex-col gap-4 p-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-foreground">{extractLocalizedText(existingProvider.businessName, locale)}</p>
              <p className="text-sm text-foreground/60">
                {t("applicationStatusLabel")}:{" "}
                <span className="font-medium text-foreground/80">{t(STATUS_LABEL_KEYS[existingProvider.status])}</span>
              </p>
              <p className="text-sm text-foreground/60">{t(STATUS_BODY_KEYS[existingProvider.status])}</p>
            </div>

            {existingProvider.status === "APPROVED" && (
              <Link
                href="/provider"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("applicationOpenWorkspaceButton")}
                <ArrowRight size={16} strokeWidth={1.75} className="rtl:-scale-x-100" />
              </Link>
            )}

            {existingProvider.status === "DRAFT" && (
              <Link
                href="/provider/verification"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {t("applicationContinueVerificationLink")}
                <ArrowRight size={16} strokeWidth={1.75} className="rtl:-scale-x-100" />
              </Link>
            )}

            {existingProvider.status === "CHANGES_REQUESTED" && (
              <div className="flex flex-col gap-3">
                {existingProvider.rejectionReason && (
                  <div className="flex flex-col gap-1 rounded-xl border border-warning/40 bg-warning/5 p-3">
                    <span className="text-xs font-medium text-warning">{t("applicationChangesRequestedReasonLabel")}</span>
                    <p className="whitespace-pre-wrap text-sm text-foreground/80">{existingProvider.rejectionReason}</p>
                  </div>
                )}
                <Link
                  href="/provider/verification"
                  className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {t("applicationContinueVerificationLink")}
                  <ArrowRight size={16} strokeWidth={1.75} className="rtl:-scale-x-100" />
                </Link>
              </div>
            )}

            {(existingProvider.status === "APPLIED" || existingProvider.status === "UNDER_REVIEW") && hasDocumentBlockers && (
              <Link
                href="/provider/verification"
                className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {t("applicationCompleteDocumentsLink")}
                <ArrowRight size={15} strokeWidth={1.75} className="rtl:-scale-x-100" />
              </Link>
            )}

            {existingProvider.status === "REJECTED" && (
              <div className="flex flex-col gap-3">
                {existingProvider.rejectionReason && (
                  <div className="flex flex-col gap-1 rounded-xl border border-danger/30 bg-danger/5 p-3">
                    <span className="text-xs font-medium text-danger">{t("applicationRejectionReasonLabel")}</span>
                    <p className="whitespace-pre-wrap text-sm text-foreground/80">{existingProvider.rejectionReason}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Gate 1A: resubmit returns REJECTED -> DRAFT; the applicant
                      then edits documents on the verification page and EXPLICITLY
                      submits again. Corrections to profile fields are made in the
                      existing Provider Settings, not duplicated here. */}
                  <form
                    action={async () => {
                      "use server";
                      const result = await resubmitProviderApplication();
                      if (!result.ok) {
                        redirect({ href: `/provider-application?error=${result.error}`, locale });
                        return;
                      }
                      redirect({ href: "/provider-application", locale });
                    }}
                  >
                    <SubmitButton className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                      {t("applicationResubmitButton")}
                    </SubmitButton>
                  </form>
                  <Link
                    href="/provider/settings"
                    className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {t("applicationFixProfileLink")}
                  </Link>
                  <Link
                    href="/provider/verification"
                    className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {t("applicationVerificationLink")}
                  </Link>
                </div>
              </div>
            )}

            {REMAIN_CUSTOMER_STATUSES.includes(existingProvider.status) && (
              <p className="text-xs text-foreground/40">{t("applicationRemainCustomerNote")}</p>
            )}

            {TERMINATED_STATUSES.includes(existingProvider.status) && (
              <Link
                href="/help"
                className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {t("applicationContactSupportLink")}
              </Link>
            )}
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
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium text-foreground/50">{t("providerTypeLabel")}</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="providerType" value="INDIVIDUAL" className="mt-0.5 h-4 w-4 text-primary" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{t("providerTypeIndividual")}</span>
                    <span className="text-xs text-foreground/50">{t("providerTypeIndividualHint")}</span>
                  </span>
                </label>
                <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="providerType" value="COMPANY" defaultChecked className="mt-0.5 h-4 w-4 text-primary" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{t("providerTypeCompany")}</span>
                    <span className="text-xs text-foreground/50">{t("providerTypeCompanyHint")}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("publicNameArLabel")}</span>
                <input
                  type="text"
                  name="businessNameAr"
                  required
                  dir="rtl"
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("publicNameEnLabel")}</span>
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

            {categoryTree && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground/50">{t("settingsAreasTitle")}</span>
                <p className="text-xs text-foreground/40">{t("settingsAreasHint")}</p>
                <ProviderCategoryChecklist tree={categoryTree} selectedIds={[]} emptyLabel={t("settingsAreasEmpty")} />
              </div>
            )}

            <SubmitButton className="mt-2 self-start rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
              {t("applicationSubmitButton")}
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
