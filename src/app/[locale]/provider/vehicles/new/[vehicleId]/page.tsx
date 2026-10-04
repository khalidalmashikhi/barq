import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import type { Locale } from "@/i18n/locales";
import { getRegistrationReview } from "@/lib/vehicles/registration-review/get-registration-review";
import { resolveVehicleCreateAccess } from "@/lib/vehicles/onboarding/vehicle-create-access";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { AnalyzeRegistrationButton } from "@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button";
import { RegistrationUploadForm } from "../_components/registration-upload-form";
import { OnboardingReviewForm, type FieldView } from "./_components/onboarding-review-form";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2: review the extracted (or
// manually-entered) registration details and explicitly confirm to finish the vehicle.
//
// AUTHORITY: the general vehicle-create rule (an APPROVED provider) + ownership — never the rental
// workspace or any vertical. A foreign/missing vehicle is non-enumerating (notFound). Once the claim
// is SUBMITTED the vehicle is finished — the provider continues on its detail page.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const EXTRACTION_STATE_LABEL: Record<"NOT_ANALYZED" | "EXTRACTED" | "NEEDS_REVIEW" | "FAILED", string> = {
  NOT_ANALYZED: "vehicleRegStateNotAnalyzed",
  EXTRACTED: "vehicleRegStateExtracted",
  NEEDS_REVIEW: "vehicleRegStateNeedsReview",
  FAILED: "vehicleRegStateFailed",
};

type Props = { params: Promise<{ vehicleId: string }>; searchParams: Promise<{ docError?: string }> };

export default async function OnboardingReviewPage({ params, searchParams }: Props) {
  const { vehicleId } = await params;
  const { docError } = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getServerTranslator("provider");
  const td = t as unknown as (key: string) => string;

  const access = await resolveVehicleCreateAccess();
  if (!access.ok) {
    if (access.reason === "UNAUTHENTICATED") {
      redirect({ href: "/login", locale });
      return null;
    }
    notFound();
  }

  const review = await getRegistrationReview(vehicleId); // owner-scoped; foreign/missing → null
  if (!review) notFound();

  // Already confirmed (claim locked) → the vehicle is finished; continue on its detail page.
  if (review.confirmation?.status === "SUBMITTED") redirect({ href: `/provider/vehicles/${vehicleId}`, locale });

  const header = (
    <>
      <Link href="/provider/vehicles" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t("vehicleOnboardReviewTitle")}</h1>
        <p className="text-sm text-foreground/70">{t("vehicleOnboardReviewSubtitle")}</p>
      </div>
    </>
  );

  // The shell has no registration document (e.g. it was removed): the next step is still the
  // document — never a blank details form. Re-upload goes through the per-vehicle document route.
  if (!review.documentId) {
    const docErrorMessage = docError
      ? isAssetDocumentErrorCode(docError)
        ? t(getAssetDocumentErrorTranslationKey(docError))
        : t("vehicleOnboardUploadFailed")
      : null;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-32 pt-6 sm:px-6 sm:pt-8">
        {header}
        <Alert variant="info">{t("vehicleOnboardMissingDocument")}</Alert>
        {docErrorMessage && <Alert variant="danger">{docErrorMessage}</Alert>}
        <Card hoverLift={false}>
          <RegistrationUploadForm
            action={`/api/provider/vehicles/${vehicleId}/documents`}
            locale={locale}
            hiddenFields={{ type: "VEHICLE_REGISTRATION" }}
            cancelHref="/provider/vehicles"
          />
        </Card>
      </div>
    );
  }

  const { reviewState } = review;
  // Automatic reading is only available for native-text PDFs. Anything else (a photo, a scan) is
  // retained privately and reviewed manually — we never claim it was read.
  const isManual = reviewState.extraction !== "EXTRACTED" && reviewState.extraction !== "NEEDS_REVIEW";
  const viewHref = `/api/provider/vehicles/${vehicleId}/documents/${review.documentId}/view`;

  // Confident type suggestion from the extracted make/model/usage text (always overridable).
  const hintText = review.fields
    .filter((f) => f.key === "make" || f.key === "model" || f.key === "usageClassification")
    .map((f) => (f.extractedValue === null ? "" : String(f.extractedValue)))
    .join(" ");
  const suggestedVehicleType = suggestVehicleType(hintText);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-40 pt-6 sm:px-6 sm:pt-8">
      {header}

      <Card hoverLift={false}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-foreground/70">{t("vehicleRegDocumentLabel")}</span>
            <a href={viewHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("vehicleDocViewButton")}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{t("vehicleRegExtractionStatusLabel")}</span>
            <Badge variant={reviewState.extraction === "EXTRACTED" ? "success" : reviewState.extraction === "FAILED" ? "warning" : "default"}>
              {td(EXTRACTION_STATE_LABEL[reviewState.extraction])}
            </Badge>
          </div>
          {/* Re-run the automatic read (owner-scoped, idempotent) — e.g. after a transient failure. */}
          {reviewState.canAnalyze && <AnalyzeRegistrationButton vehicleId={vehicleId} retry={reviewState.extraction === "FAILED"} />}
        </div>
      </Card>

      <OnboardingReviewForm
        vehicleId={vehicleId}
        fields={review.fields as FieldView[]}
        vehicleTypeOptions={vehicleTypeOptions(locale)}
        suggestedVehicleType={suggestedVehicleType}
        isManual={isManual}
      />
    </div>
  );
}
