import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import type { RegistrationReviewView } from "@/lib/vehicles/registration-review/get-registration-review";
import { AnalyzeRegistrationButton } from "@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button";
import { RegistrationConfirmationForm, type FieldView } from "@/app/[locale]/provider/vehicles/[id]/_components/registration-confirmation-form";

// Phase 3C Slice 3A — provider registration review SECTION (server component), rendered on the
// vehicle detail page beside the verification/documents section. Shows the document + extraction
// status with SAFE localized labels (never an internal code/stack trace), an authorized signed
// document View link, an analyze/retry control, and the provider confirmation form. It presents
// a private provider CLAIM only — it never approves the vehicle and never updates the Vehicle row.

const EXTRACTION_STATE_LABEL: Record<RegistrationReviewView["reviewState"]["extraction"], string> = {
  NOT_ANALYZED: "vehicleRegStateNotAnalyzed",
  EXTRACTED: "vehicleRegStateExtracted",
  NEEDS_REVIEW: "vehicleRegStateNeedsReview",
  FAILED: "vehicleRegStateFailed",
};

export async function RegistrationReviewSection({ vehicleId, review }: { vehicleId: string; review: RegistrationReviewView }) {
  const t = await getTranslations("provider");
  const td = t as unknown as (key: string) => string; // dynamic state/failure-label keys (parity-guaranteed)
  const { reviewState } = review;

  // No registration document uploaded yet — point the provider to the documents section above.
  if (!review.documentId) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t("vehicleRegReviewTitle")}</h2>
        <p className="text-sm text-foreground/60">{t("vehicleRegReviewSubtitle")}</p>
        <Card hoverLift={false}>
          <p className="text-sm text-foreground/60">{t("vehicleRegNoDocument")}</p>
        </Card>
      </section>
    );
  }

  const viewHref = `/api/provider/vehicles/${vehicleId}/documents/${review.documentId}/view`;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{t("vehicleRegReviewTitle")}</h2>
      <p className="text-sm text-foreground/60">{t("vehicleRegReviewSubtitle")}</p>

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

          {review.lastAttemptedAt && (
            <p className="text-xs text-foreground/50">
              {t("vehicleRegLastAttempted")}: {review.lastAttemptedAt.toISOString().slice(0, 10)}
              {review.lastSucceededAt ? ` · ${t("vehicleRegLastSucceeded")}: ${review.lastSucceededAt.toISOString().slice(0, 10)}` : ""}
            </p>
          )}

          {reviewState.canAnalyze && <AnalyzeRegistrationButton vehicleId={vehicleId} retry={reviewState.extraction === "FAILED"} />}
        </div>
      </Card>

      {reviewState.confirmation === "STALE" && <Alert variant="warning">{t("vehicleRegConfStale")}</Alert>}
      {reviewState.confirmation === "SUPERSEDED" && <Alert variant="info">{t("vehicleRegConfSuperseded")}</Alert>}

      {reviewState.locked && review.confirmation ? (
        <Card hoverLift={false}>
          <Alert variant="success">{t("vehicleRegConfSubmitted")}</Alert>
          {review.confirmation.submittedAt && (
            <p className="mt-2 text-xs text-foreground/50">{t("vehicleRegSubmittedOn")}: {review.confirmation.submittedAt.toISOString().slice(0, 10)}</p>
          )}
          <p className="mt-2 text-sm text-foreground/70">{t("vehicleRegAwaitingAdmin")}</p>
        </Card>
      ) : null}

      {(reviewState.canConfirm || reviewState.locked) && (
        <RegistrationConfirmationForm
          vehicleId={vehicleId}
          fields={review.fields as FieldView[]}
          canConfirm={reviewState.canConfirm}
          locked={reviewState.locked}
        />
      )}
    </section>
  );
}
