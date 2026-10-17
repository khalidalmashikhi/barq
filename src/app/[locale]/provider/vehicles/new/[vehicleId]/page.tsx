import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { AlertTriangle, ArrowRight, FileText } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import type { Locale } from "@/i18n/locales";
import { getRegistrationReview, type RegistrationReviewPageView } from "@/lib/vehicles/registration-review/get-registration-review";
import { CONFIRMATION_FIELDS, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { resolveVehicleCreateAccess } from "@/lib/vehicles/onboarding/vehicle-create-access";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { isRegistrationOcrOperational } from "@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader";
import { AnalyzeRegistrationButton } from "@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button";
import { RegistrationUploadForm } from "../_components/registration-upload-form";
import { OnboardingReviewForm, type FieldView } from "./_components/onboarding-review-form";
import { ExtractionProgress } from "./_components/extraction-progress";
import { OcrConsentStep } from "./_components/ocr-consent-step";
import { RegistrationRecoveryBanner } from "./_components/registration-recovery-banner";
import { VehicleJourneySteps, type JourneyProgress } from "@/components/provider/vehicle-journey/journey-steps";
import { JourneyStatusProvider } from "@/components/provider/vehicle-journey/journey-status";
import { JOURNEY_CARD, JOURNEY_PAGE, JOURNEY_TITLE } from "@/components/provider/vehicle-journey/journey-ui";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2: review the extracted (or
// manually-entered) registration details and explicitly confirm to finish the vehicle.
//
// The details may come from the document's native text, from OCR of a photo/scan, or from the
// provider. Whatever the source, they are SUGGESTIONS shown for review: the form marks what was read
// automatically and what needs checking, and nothing is saved to the vehicle until the provider
// confirms. A failed or unavailable reading keeps the document and leaves retry + manual entry.
//
// THE SET: the registration is one PDF, one photo, or front + back photos. Every stored side is
// shown here (inline preview for photos, through the owner-checked signed view route; a safe
// "open" link for a PDF with its name and size) so the provider reviews the values against the
// whole document. A field the document showed with two different values is offered as a choice.
//
// PRIVACY GATE: a photo/scan — or a PDF whose text could not be read locally — is NEVER sent for
// automatic (external) reading until the provider has seen the standalone processing notice and
// chosen "read automatically" — the OcrConsentStep, whose wording names exactly what would be sent
// (the PDF, the photo, or all photos together). Until then (AWAITING_CONSENT) there is no form to
// fill; after a decline the same form is the manual path with the compact notice above it; after a
// notice change the provider is asked again.
//
// AUTHORITY: the general vehicle-create rule (an APPROVED provider) + ownership — never the rental
// workspace or any vertical. A foreign/missing vehicle is non-enumerating (notFound). Once the claim
// is SUBMITTED the vehicle is finished — the provider continues on its detail page.

export const metadata: Metadata = { robots: { index: false, follow: false } };

const EXTRACTION_STATE_LABEL: Record<"NOT_ANALYZED" | "PROCESSING" | "AWAITING_CONSENT" | "EXTRACTED" | "NEEDS_REVIEW" | "FAILED", string> = {
  PROCESSING: "vehicleRegStateProcessing",
  AWAITING_CONSENT: "vehicleRegStateAwaitingChoice",
  NOT_ANALYZED: "vehicleRegStateNotAnalyzed",
  EXTRACTED: "vehicleRegStateExtracted",
  NEEDS_REVIEW: "vehicleRegStateNeedsReview",
  FAILED: "vehicleRegStateFailed",
};

const SET_SUMMARY_KEY = { PDF: "vehicleOnboardSetSummaryPdf", IMAGE: "vehicleOnboardSetSummaryImage", IMAGES: "vehicleOnboardSetSummaryImages" } as const;
const PAGE_LABEL_KEY = { FRONT: "vehicleRegPageFront", BACK: "vehicleRegPageBack" } as const;
const PREVIEW_ALT_KEY = { FRONT: "vehicleOnboardPreviewAlt", BACK: "vehicleOnboardBackPreviewAlt" } as const;

function megabytes(bytes: number): string {
  return (Math.max(bytes, 0) / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1);
}

type Props = { params: Promise<{ vehicleId: string }>; searchParams: Promise<{ docError?: string; resumed?: string }> };

export default async function OnboardingReviewPage({ params, searchParams }: Props) {
  const { vehicleId } = await params;
  const { docError, resumed } = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getServerTranslator("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;

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

  const backLink = (
    <Link href="/provider/vehicles" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
      <ArrowRight size={16} strokeWidth={1.75} aria-hidden className="ltr:rotate-180" />
      {t("backToVehiclesLabel")}
    </Link>
  );
  const pageHeader = (title: string, subtitle: string | null, progress: JourneyProgress) => (
    <>
      {backLink}
      <div className="flex flex-col gap-1.5">
        <h1 className={JOURNEY_TITLE}>{title}</h1>
        {subtitle && <p className="text-sm text-foreground/70">{subtitle}</p>}
      </div>
      <VehicleJourneySteps progress={progress} />
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
      <div className={JOURNEY_PAGE}>
        {pageHeader(t("addVehicleButton"), null, { stage: "upload" })}
        <Alert variant="info">{t("vehicleOnboardMissingDocument")}</Alert>
        {docErrorMessage && <Alert variant="danger">{docErrorMessage}</Alert>}
        <RegistrationUploadForm
          action={`/api/provider/vehicles/${vehicleId}/documents`}
          locale={locale}
          hiddenFields={{ type: "VEHICLE_REGISTRATION" }}
          successHref={`/provider/vehicles/new/${vehicleId}`}
          cancelHref="/provider/vehicles"
          ocrAvailable={isRegistrationOcrOperational()}
          singleFile
        />
      </div>
    );
  }

  const { reviewState } = review;
  // No usable reading (not analyzed, failed, or OCR unavailable): the document is retained privately
  // and the provider enters the details — we never claim it was read.
  const isManual = reviewState.extraction !== "EXTRACTED" && reviewState.extraction !== "NEEDS_REVIEW";
  const isReading = reviewState.extraction === "PROCESSING";
  // The provider's choice about EXTERNAL reading of this set is pending (or was a decline).
  const consent = review.ocrConsent;
  const awaitingChoice = reviewState.extraction === "AWAITING_CONSENT" && consent !== null;
  const declined = awaitingChoice && consent.state === "DECLINED";
  const setKind = review.setKind ?? "IMAGE";
  const setSummary = t(SET_SUMMARY_KEY[setKind]);
  const viewHrefFor = (page: RegistrationReviewPageView) => `/api/provider/vehicles/${vehicleId}/documents/${page.documentId}/view`;
  // A reading that FAILED (and may be retried) gets its own concise panel — retry or enter manually —
  // instead of a notice buried above the form.
  const readingFailed = reviewState.extraction === "FAILED" && reviewState.canAnalyze;
  // What the form should say above the fields: the precise failure reason when there is one, the
  // OCR caution when the values were read from a photo/scan, otherwise the generic manual notice.
  const noticeKey = declined
    ? "vehicleRegConsentDeclinedNotice"
    : readingFailed
      ? null
      : isManual
        ? (reviewState.failureLabelKey ?? "vehicleOnboardManualNotice")
        : review.extractionSource === "OCR"
          ? "vehicleOnboardOcrNotice"
          : null;

  // The body-style suggestion and the printed description come from the read model; the form only
  // OFFERS the suggestion — the provider chooses the type explicitly.
  const suggestedVehicleType = review.vehicleTypeSuggestion;

  // Card 1's summary: how many fields the reading found, and how many of those need a look.
  // (only fields a document can carry count — bookable capacity is always the provider's own entry)
  const readableFields = review.fields.filter((f) => CONFIRMATION_FIELDS[f.key as ConfirmationFieldKey].extractionKey !== null);
  const foundCount = readableFields.filter((f) => f.extractedValue !== null).length;
  const reviewCount = review.fields.filter((f) => f.needsReview && f.extractedValue !== null).length;

  // What the header may say about step 2 on the review page: completed ONLY after a real reading;
  // a failed reading is an error (never a check mark); a declined / not-analysed document was not read.
  const readingOutcome: "succeeded" | "failed" | "skipped" = !isManual ? "succeeded" : reviewState.extraction === "FAILED" ? "failed" : "skipped";

  // Step 2 (read details) while the provider decides or the reading runs; step 3 (review) otherwise.
  if (isReading || (awaitingChoice && !declined)) {
    return (
      <div className={JOURNEY_PAGE}>
        {/* The consent step can report a failed attempt to the header (step 2: current + error). */}
        <JourneyStatusProvider>
          {pageHeader(t("addVehicleButton"), null, { stage: "read" })}
          {resumed === "1" && <Alert variant="info">{t("vehicleOnboardResumedNotice")}</Alert>}
          {isReading ? (
            // Another request is reading the document right now: wait for it (bounded) instead of
            // opening an empty form whose suggestions are about to arrive.
            <ExtractionProgress summary={setSummary} />
          ) : (
            // Nothing has been sent anywhere. The provider reads the processing notice and chooses;
            // "enter manually" opens the review form as the manual path.
            <OcrConsentStep vehicleId={vehicleId} mode={consent!.state === "STALE" ? "stale" : "choose"} inferenceGeo={consent!.inferenceGeo} setKind={setKind} />
          )}
        </JourneyStatusProvider>
      </div>
    );
  }

  return (
    <div className={JOURNEY_PAGE}>
      {/* The subtitle speaks of document suggestions — only when there are some (never after a failed or declined reading). */}
      {pageHeader(t("vehicleOnboardReviewTitle"), isManual ? null : t("vehicleOnboardReviewSubtitle"), { stage: "review", reading: readingOutcome })}

      {/* A repeated/replayed upload request was answered with this existing setup (idempotency). */}
      {resumed === "1" && <Alert variant="info">{t("vehicleOnboardResumedNotice")}</Alert>}

      {/* Compact document summary: every stored side, in order, through the SAME owner-checked,
          short-lived signed view route (never a public URL, never the storage key). */}
      <section aria-label={t("vehicleRegDocumentLabel")} className={`${JOURNEY_CARD} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText size={20} strokeWidth={1.75} aria-hidden className="text-secondary-700" />
            {t("vehicleRegDocumentLabel")}
          </p>
          <Badge variant={reviewState.extraction === "EXTRACTED" ? "success" : reviewState.extraction === "FAILED" ? "warning" : "default"}>
            <span className="sr-only">{t("vehicleRegExtractionStatusLabel")}: </span>
            {td(EXTRACTION_STATE_LABEL[reviewState.extraction])}
          </Badge>
        </div>
        <p className="text-sm text-foreground/75">{setSummary}</p>
        {/* What the reading found — one short line, never the privacy notice again. */}
        {!isManual && (
          <p className="text-sm text-foreground/80" data-reading-summary="">
            {td("vehicleCardDocFound", { found: foundCount, total: readableFields.length })}
            {reviewCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{td("vehicleCardDocReview", { count: reviewCount })}</span>
              </>
            )}
          </p>
        )}
        <ul className="flex flex-wrap gap-3">
          {review.pages.map((page) => {
            const viewHref = viewHrefFor(page);
            const isImage = page.mimeType.startsWith("image/");
            return (
              <li key={page.documentId} className="flex min-w-0 flex-1 basis-36 flex-col gap-1.5 rounded-2xl border border-border bg-background p-2">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, signed, short-lived document view; it must not go through the public image optimizer
                  <img src={viewHref} alt={t(PREVIEW_ALT_KEY[page.role])} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-24 w-full rounded-xl bg-card object-cover" />
                ) : (
                  <p className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-card px-2 py-3 text-center text-sm text-foreground/80">
                    <FileText size={20} strokeWidth={1.6} aria-hidden className="shrink-0 text-secondary-700" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {page.filename && <bdi>{page.filename}</bdi>}
                      {page.filename && " · "}
                      {td("vehicleOnboardFileSizeMb", { size: megabytes(page.sizeBytes) })}
                    </span>
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-2 px-1">
                  <span className="text-sm font-medium text-foreground/80">{setKind === "PDF" ? t("vehicleRegPagePdf") : t(PAGE_LABEL_KEY[page.role])}</span>
                  <a href={viewHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {t("vehicleDocViewButton")}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
        {/* Re-run the automatic read (owner-scoped, idempotent) when it is offered and not covered by the failure panel. */}
        {reviewState.canAnalyze && !readingFailed && <AnalyzeRegistrationButton vehicleId={vehicleId} retry={false} />}
      </section>

      {readingFailed && (
        // Concise failure: what happened, retry (when allowed) and the manual path right below.
        <section role="status" className={`${JOURNEY_CARD} flex flex-col gap-3 border-warning/40`}>
          <p className="flex items-start gap-2 text-base font-semibold text-foreground">
            <AlertTriangle size={20} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-warning" />
            <span>{td(reviewState.failureLabelKey ?? "vehicleOnboardManualNotice")}</span>
          </p>
          <AnalyzeRegistrationButton vehicleId={vehicleId} retry />
          <p className="text-sm text-foreground/70">{t("vehicleJourneyReadingFailedManual")}</p>
        </section>
      )}

      {declined && <OcrConsentStep vehicleId={vehicleId} mode="declined" inferenceGeo={consent!.inferenceGeo} setKind={setKind} />}
      {/* Recovery of a stale or incomplete reading — state derived on the server (never on the client). */}
      <RegistrationRecoveryBanner
        vehicleId={vehicleId}
        state={review.recovery.state}
        completionAvailable={review.recovery.completionAvailable}
        completionInProgress={review.recovery.completionInProgress}
        completionApplied={review.recovery.completionApplied}
        completionFailed={review.recovery.completionFailed}
        consentState={review.ocrConsent?.state ?? null}
        inferenceGeo={review.ocrConsent?.inferenceGeo ?? "us"}
      />
      <OnboardingReviewForm
        vehicleId={vehicleId}
        fields={review.fields as FieldView[]}
        vehicleTypeOptions={vehicleTypeOptions(locale)}
        suggestedVehicleType={suggestedVehicleType}
        documentDescription={review.documentDescription}
        noticeKey={noticeKey}
        noticeVariant={isManual && reviewState.failureLabelKey ? "warning" : "info"}
        tabBinding={review.tabBinding}
      />
    </div>
  );
}
