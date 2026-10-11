"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { RefreshCw, ScanLine, Info } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";
import { rereadRegistrationAction, completeRegistrationReadingAction } from "../recovery-actions";
import { OcrConsentStep } from "./ocr-consent-step";

// Phase 3C (incomplete native-PDF correction, 2026-10-09) — the recovery banner of the review step.
// The STATE comes from the server (the read model compares the stored semantic version and the
// stored result); this island only offers the matching action:
//
//   STALE      → "Read document again": a LOCAL re-read on the server — never an external request.
//   INCOMPLETE → manual entry stays open below; when available, the separate, optional "Complete
//                automatic reading". Without the provider's current consent for this exact file the
//                button opens the standard consent step first (nothing is sent before the explicit
//                choice; uploading, reloading or retrying never grants consent).
//
// The two actions have distinct labels and icons. The banner is announced politely (role="status").
// No version number, engine, vendor or "AI" wording appears here.

type Props = {
  vehicleId: string;
  state: "STALE" | "INCOMPLETE" | null;
  completionAvailable: boolean;
  completionInProgress: boolean;
  completionApplied: boolean;
  completionFailed: boolean;
  /** The provider's current decision for this exact set (null = automatic reading not configured). */
  consentState: "NONE" | "GRANTED" | "DECLINED" | "STALE" | null;
  inferenceGeo: "us" | "global";
};

const ACTION = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

export function RegistrationRecoveryBanner({ vehicleId, state, completionAvailable, completionInProgress, completionApplied, completionFailed, consentState, inferenceGeo }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // result-code message keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"reread" | "complete" | null>(null);
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);
  const [askConsent, setAskConsent] = useState(false);

  const reread = () => {
    setErrorCode(null);
    setBusy("reread");
    startTransition(async () => {
      const res = await rereadRegistrationAction(vehicleId);
      setBusy(null);
      if (!res.ok) return setErrorCode(res.code);
      router.refresh();
    });
  };

  const complete = () => {
    setErrorCode(null);
    // No current consent for this exact file → the explicit choice first; nothing is sent yet.
    if (consentState !== "GRANTED") {
      setAskConsent(true);
      return;
    }
    setBusy("complete");
    startTransition(async () => {
      const res = await completeRegistrationReadingAction(vehicleId);
      setBusy(null);
      if (!res.ok) {
        if (res.code === "OCR_CONSENT_REQUIRED") return setAskConsent(true);
        return setErrorCode(res.code);
      }
      router.refresh();
    });
  };

  if (completionInProgress) {
    return (
      <div role="status" aria-live="polite">
        <Alert variant="info">{t("vehicleRegCompletionInProgress")}</Alert>
      </div>
    );
  }
  if (!state && !completionApplied) return null;

  return (
    <div className="flex flex-col gap-3">
      <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-2xl border border-border bg-accent/10 p-4">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <Info size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {state === "STALE"
              ? t("vehicleRegRecoveryStale")
              : state === "INCOMPLETE"
                ? completionAvailable
                  ? t("vehicleRegRecoveryIncomplete")
                  : t("vehicleRegRecoveryIncompleteManual")
                : t("vehicleRegCompletionAppliedNotice")}
          </span>
        </p>
        {state === "INCOMPLETE" && completionFailed && <p className="text-xs text-foreground/70">{t("vehicleRegCompletionFailed")}</p>}

        {state === "STALE" && (
          <button type="button" onClick={reread} disabled={pending} className={`${ACTION} w-fit bg-primary text-primary-foreground hover:opacity-90`}>
            <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
            {busy === "reread" ? t("vehicleRegRereadPending") : t("vehicleRegRereadButton")}
          </button>
        )}
        {state === "INCOMPLETE" && completionAvailable && !askConsent && (
          <button type="button" onClick={complete} disabled={pending} className={`${ACTION} w-fit border border-border text-foreground hover:bg-accent`}>
            <ScanLine size={15} strokeWidth={1.75} aria-hidden />
            {busy === "complete" ? t("vehicleRegCompletionPending") : t("vehicleRegCompleteReadingButton")}
          </button>
        )}
        {errorCode && <Alert variant="danger">{td(registrationReviewMessageKey(errorCode))}</Alert>}
      </div>

      {state === "INCOMPLETE" && completionAvailable && askConsent && (
        <OcrConsentStep vehicleId={vehicleId} mode={consentState === "STALE" ? "stale" : "choose"} inferenceGeo={inferenceGeo} setKind="PDF" intent="complete" onDeclined={() => setAskConsent(false)} />
      )}
    </div>
  );
}
