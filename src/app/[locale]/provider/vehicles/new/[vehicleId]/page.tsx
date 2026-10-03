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
import { resolveRentalWorkspaceViewAccess } from "@/lib/offerings/rental/provider/rental-workspace-access";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { OnboardingReviewForm, type FieldView } from "./_components/onboarding-review-form";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2/3: review the extracted
// (or manually-entered) registration details and confirm to create the DRAFT Vehicle. RENTAL_COMPANY
// gated; a foreign/missing vehicle is non-enumerating (notFound). Once the claim is SUBMITTED the
// vehicle exists — we send the provider on to its detail page rather than re-showing the wizard.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const EXTRACTION_STATE_LABEL: Record<"NOT_ANALYZED" | "EXTRACTED" | "NEEDS_REVIEW" | "FAILED", string> = {
  NOT_ANALYZED: "vehicleRegStateNotAnalyzed",
  EXTRACTED: "vehicleRegStateExtracted",
  NEEDS_REVIEW: "vehicleRegStateNeedsReview",
  FAILED: "vehicleRegStateFailed",
};

type Props = { params: Promise<{ vehicleId: string }> };

export default async function OnboardingReviewPage({ params }: Props) {
  const { vehicleId } = await params;
  const locale = (await getLocale()) as Locale;
  const t = await getServerTranslator("provider");
  const td = t as unknown as (key: string) => string;

  // RENTAL_COMPANY gate — non-rental / non-authenticated collapse to not-found (non-enumerating).
  const access = await resolveRentalWorkspaceViewAccess();
  if (!access.ok) notFound();

  const review = await getRegistrationReview(vehicleId);
  if (!review) notFound();

  // The shell always has a document (step 1 uploaded one); if somehow absent, restart at step 1.
  if (!review.documentId) redirect({ href: "/provider/vehicles/new", locale });

  // Already created (claim locked) → the vehicle is real; continue on its detail page.
  if (review.confirmation?.status === "SUBMITTED") redirect({ href: `/provider/vehicles/${vehicleId}`, locale });

  const { reviewState } = review;
  const isManual = reviewState.extraction === "FAILED";
  const viewHref = `/api/provider/vehicles/${vehicleId}/documents/${review.documentId}/view`;

  // Confident type suggestion from the extracted make/model/usage text (always overridable).
  const hintText = review.fields
    .filter((f) => f.key === "make" || f.key === "model" || f.key === "usageClassification")
    .map((f) => (f.extractedValue === null ? "" : String(f.extractedValue)))
    .join(" ");
  const suggestedVehicleType = suggestVehicleType(hintText);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <Link href="/provider/vehicles" className="inline-flex w-fit items-center gap-2 text-sm text-foreground/60 hover:text-foreground">
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        {t("backToVehiclesLabel")}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t("vehicleOnboardReviewTitle")}</h1>
        <p className="text-sm text-foreground/60">{t("vehicleOnboardReviewSubtitle")}</p>
      </div>

      <Card hoverLift={false}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-foreground/70">{t("vehicleRegDocumentLabel")}</span>
            <a href={viewHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
              {t("vehicleDocViewButton")}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{t("vehicleRegExtractionStatusLabel")}</span>
            <Badge variant={reviewState.extraction === "EXTRACTED" ? "success" : reviewState.extraction === "FAILED" ? "danger" : "default"}>
              {td(EXTRACTION_STATE_LABEL[reviewState.extraction])}
            </Badge>
          </div>
          {reviewState.failureLabelKey && <Alert variant="warning">{td(reviewState.failureLabelKey)}</Alert>}
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
