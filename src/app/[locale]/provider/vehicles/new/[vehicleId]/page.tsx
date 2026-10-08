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
import { getRegistrationReview, type RegistrationReviewPageView } from "@/lib/vehicles/registration-review/get-registration-review";
import { resolveVehicleCreateAccess } from "@/lib/vehicles/onboarding/vehicle-create-access";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import { isAssetDocumentErrorCode, getAssetDocumentErrorTranslationKey } from "@/lib/vehicles/documents/asset-document-errors";
import { isRegistrationOcrOperational } from "@/lib/vehicles/registration-extraction/ocr/get-registration-document-reader";
import { AnalyzeRegistrationButton } from "@/app/[locale]/provider/vehicles/[id]/_components/analyze-registration-button";
import { RegistrationUploadForm } from "../_components/registration-upload-form";
import { OnboardingReviewForm, type FieldView } from "./_components/onboarding-review-form";
import { ExtractionProgress } from "./_components/extraction-progress";
import { OcrConsentStep } from "./_components/ocr-consent-step";

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
            successHref={`/provider/vehicles/new/${vehicleId}`}
            cancelHref="/provider/vehicles"
            ocrAvailable={isRegistrationOcrOperational()}
            singleFile
          />
        </Card>
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
  const viewHrefFor = (page: RegistrationReviewPageView) => `/api/provider/vehicles/${vehicleId}/documents/${page.documentId}/view`;
  // What the form should say above the fields: the precise failure reason when there is one, the
  // OCR caution when the values were read from a photo/scan, otherwise the generic manual notice.
  const noticeKey = declined
    ? "vehicleRegConsentDeclinedNotice"
    : isManual
      ? (reviewState.failureLabelKey ?? "vehicleOnboardManualNotice")
      : review.extractionSource === "OCR"
        ? "vehicleOnboardOcrNotice"
        : null;

  // Confident type suggestion from the extracted make/model/usage text (always overridable).
  const hintText = review.fields
    .filter((f) => f.key === "make" || f.key === "model" || f.key === "usageClassification")
    .map((f) => (f.extractedValue === null ? "" : String(f.extractedValue)))
    .join(" ");
  const suggestedVehicleType = suggestVehicleType(hintText);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-40 pt-6 sm:px-6 sm:pt-8">
      {header}

      {/* A repeated/replayed upload request was answered with this existing setup (idempotency). */}
      {resumed === "1" && <Alert variant="info">{t("vehicleOnboardResumedNotice")}</Alert>}

      <Card hoverLift={false}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-foreground/70">{t("vehicleRegDocumentLabel")}</span>
            <span className="text-xs text-foreground/60">{t(SET_SUMMARY_KEY[setKind])}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{t("vehicleRegExtractionStatusLabel")}</span>
            <Badge variant={reviewState.extraction === "EXTRACTED" ? "success" : reviewState.extraction === "FAILED" ? "warning" : "default"}>
              {td(EXTRACTION_STATE_LABEL[reviewState.extraction])}
            </Badge>
          </div>
          {/* Every stored side, in order. A photo is previewed inline through the SAME owner-checked,
              short-lived signed view route (never a public URL, never the storage key); a PDF keeps a
              safe "view" link with its name and size. */}
          <ul className="flex flex-col gap-3">
            {review.pages.map((page) => {
              const viewHref = viewHrefFor(page);
              const isImage = page.mimeType.startsWith("image/");
              return (
                <li key={page.documentId} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-foreground/60">{setKind === "PDF" ? t("vehicleRegPagePdf") : t(PAGE_LABEL_KEY[page.role])}</span>
                    <a href={viewHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      {t("vehicleDocViewButton")}
                    </a>
                  </div>
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private, signed, short-lived document view; it must not go through the public image optimizer
                    <img
                      src={viewHref}
                      alt={t(PREVIEW_ALT_KEY[page.role])}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="max-h-72 w-full rounded-xl border border-border bg-accent/10 object-contain"
                    />
                  ) : (
                    <p className="break-words text-sm text-foreground/80">
                      {page.filename && <bdi>{page.filename}</bdi>}
                      {page.filename && " · "}
                      {td("vehicleOnboardFileSizeMb", { size: megabytes(page.sizeBytes) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {/* Re-run the automatic read (owner-scoped, idempotent) — e.g. after a transient failure. */}
          {reviewState.canAnalyze && <AnalyzeRegistrationButton vehicleId={vehicleId} retry={reviewState.extraction === "FAILED"} />}
        </div>
      </Card>

      {isReading ? (
        // Another request is reading the document right now: wait for it (bounded) instead of
        // opening an empty form whose suggestions are about to arrive.
        <ExtractionProgress />
      ) : awaitingChoice && !declined ? (
        // Nothing has been sent anywhere. The provider reads the processing notice and chooses;
        // "enter manually" opens the same form below as the manual path.
        <OcrConsentStep vehicleId={vehicleId} mode={consent.state === "STALE" ? "stale" : "choose"} inferenceGeo={consent.inferenceGeo} setKind={setKind} />
      ) : (
        <>
        {declined && <OcrConsentStep vehicleId={vehicleId} mode="declined" inferenceGeo={consent.inferenceGeo} setKind={setKind} />}
        <OnboardingReviewForm
          vehicleId={vehicleId}
          fields={review.fields as FieldView[]}
          vehicleTypeOptions={vehicleTypeOptions(locale)}
          suggestedVehicleType={suggestedVehicleType}
          noticeKey={noticeKey}
          noticeVariant={isManual && reviewState.failureLabelKey ? "warning" : "info"}
        />
        </>
      )}
    </div>
  );
}
