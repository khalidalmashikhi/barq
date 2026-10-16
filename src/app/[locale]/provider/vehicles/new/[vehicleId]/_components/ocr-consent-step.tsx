"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ScanLine, PencilLine, ShieldCheck, ChevronDown, CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";
import { grantOcrConsentAction, grantOcrConsentForCompletionAction, declineOcrConsentAction } from "../consent-actions";
import { ReadingStatusPanel } from "@/components/provider/vehicle-journey/reading-status-panel";
import { JOURNEY_CARD, JOURNEY_PRIMARY, JOURNEY_SECONDARY, JOURNEY_TERTIARY } from "@/components/provider/vehicle-journey/journey-ui";

// Phase 3C (registration OCR privacy gate) — the STANDALONE processing-notice + choice step shown
// after a photo/scan (or a PDF whose text could not be read locally) is uploaded and BEFORE any
// byte may leave BARQ:
//
//   "Continue with automatic reading" → records the provider's consent (with the owner/authorized
//   attestation) and only then starts the external reading;
//   "Enter the details manually"      → records the decline; the review form is the manual path.
//
// LAYERED (2026-10-16 presentation): the ordinary workflow says only that a copy of the document is
// used to extract and SUGGEST the vehicle details, and that nothing is accepted before the provider
// reviews and saves it — plus a visible Privacy Policy link, the attestation and the two choices.
// The collapsed "Privacy details" adds ONE neutral sentence: an external technical processing
// provider may be used under the Privacy Policy, and the provider may decline and enter the details
// manually — then what automatic reading does not do, and that the choice is recorded. The full
// disclosure (the processor's identity, what exactly is sent, where it is processed, purpose,
// retention) lives in the Privacy Policy's "automatic reading" section, linked from here. Nothing in
// this step names a vendor, a model, "AI", a country or a server location; nothing claims the
// processing happens only in Oman or that BARQ performs all of it.
//
// TAP FEEDBACK (2026-10-16): the grant action records the consent and then WAITS for the reading
// (an external request of several seconds) before it returns. The tap is therefore acknowledged in
// the same frame — a synchronous in-flight guard (a second tap is ignored, so no second request and
// no second consent row) and the step is replaced by the shared calm reading panel (pulsing document
// mark, "Reading vehicle details…", what is being read, a polite live region; 2026-10-16 visual
// checkpoint) — no button remains to tap twice. The pending state lasts until the result page
// replaces this step; a failure or a dropped request ends it with the honest error and both choices
// available again (the checkbox stays ticked). No fabricated progress percentage.
//
// The choice is recorded on the server with the time, the complete document set, the purpose, the
// locale, the configured geography and the notice version. Nothing here claims the notice alone
// makes the processing lawful.
//
// `mode: "declined"` renders the compact variant shown above the manual form after a decline, so
// the provider can still change their mind; `mode: "stale"` says the notice changed since they
// last agreed (the details open by default then). Copy never shows engine names, model ids, error
// codes or raw results.

type Props = {
  vehicleId: string;
  mode: "choose" | "declined" | "stale";
  /** Where inference runs for this deployment. Since 2026-10-16 it is stated in the Privacy Policy's
   *  automatic-reading section, not in this step (kept so callers stay unchanged). */
  inferenceGeo: "us" | "global";
  /** What the stored set is — decides the intro (a PDF reaches this step only when local reading failed). */
  setKind: "PDF" | "IMAGE" | "IMAGES";
  /**
   * "read" (default): the regular choice for a photo/scan or an unreadable PDF.
   * "complete" (2026-10-09): asked from the recovery banner to COMPLETE an incomplete local PDF
   * reading — same notice, same attestation, same recorded consent; the grant then starts the
   * completion instead of a full reading.
   */
  intent?: "read" | "complete";
  /** "complete" intent only: the provider chose manual entry (the banner closes the step). */
  onDeclined?: () => void;
};

// What is being read, shown in the reading state (the same set summaries as the page).
const SET_SUMMARY_KEY = { PDF: "vehicleOnboardSetSummaryPdf", IMAGE: "vehicleOnboardSetSummaryImage", IMAGES: "vehicleOnboardSetSummaryImages" } as const;
/** Three short reassurances shown above the choice. */
const TRUST_KEYS = ["vehicleJourneyTrust1", "vehicleJourneyTrust2", "vehicleJourneyTrust3"] as const;

/** Where the full automatic-reading disclosure lives (the Privacy Policy section anchor). */
export const AUTOMATIC_READING_POLICY_HREF = "/privacy#automatic-reading";

export function OcrConsentStep({ vehicleId, mode, setKind, intent = "read", onDeclined }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // result-code message keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(mode !== "declined");
  const [ownerAuthorized, setOwnerAuthorized] = useState(false);
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);
  const [busy, setBusy] = useState<"read" | "manual" | null>(null);
  // Synchronous re-entry guard: set in the SAME event as the tap, before React re-renders, so a
  // double tap can never start a second request (or record a second consent).
  const inFlight = useRef(false);

  const run = (which: "read" | "manual") => {
    if (inFlight.current) return;
    if (which === "read" && !ownerAuthorized) return;
    inFlight.current = true;
    setErrorCode(null);
    setBusy(which);
    const settle = (code: RegistrationReviewCode | null) => {
      inFlight.current = false;
      setBusy(null);
      if (code) setErrorCode(code);
    };
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof declineOcrConsentAction>>;
      try {
        res =
          which === "read"
            ? intent === "complete"
              ? await grantOcrConsentForCompletionAction(vehicleId, ownerAuthorized)
              : await grantOcrConsentAction(vehicleId, ownerAuthorized)
            : await declineOcrConsentAction(vehicleId);
      } catch {
        // The request itself failed (connection dropped, function timed out): never stay pending.
        settle("UNKNOWN_ERROR");
        return;
      }
      if (!res.ok) {
        settle(res.code);
        return;
      }
      // The consent is recorded; a completion that could not run (budget, failure) is reported here
      // while the local reading and manual entry stay as they were.
      if (res.completion && !res.completion.ok) {
        settle(res.completion.code);
        router.refresh();
        return;
      }
      // The consent is recorded but the reading produced no result (an error, a failure, or still
      // awaiting): end the pending state — the refreshed page shows the retry and the manual path.
      const analysis = res.analysis;
      if (analysis && !analysis.ok) {
        settle(analysis.code);
        router.refresh();
        return;
      }
      if (analysis && (analysis.status === "FAILED" || analysis.status === "AWAITING_CONSENT")) {
        settle(null);
        router.refresh();
        return;
      }
      if (which === "manual" && intent === "complete") {
        settle(null);
        onDeclined?.();
      }
      // Granted → the refreshed page shows the suggestions (or the honest failure with retry and manual
      // entry); declined → the manual form. The pending state stays until that page replaces this step.
      router.refresh();
    });
  };

  const reading = busy === "read";

  if (!expanded) {
    return (
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-foreground/80">{t("vehicleRegConsentDeclinedNotice")}</p>
        <button type="button" onClick={() => setExpanded(true)} className={JOURNEY_SECONDARY}>
          <ScanLine size={18} strokeWidth={1.75} aria-hidden />
          {t("vehicleRegConsentChangeMind")}
        </button>
      </div>
    );
  }

  const readDisabled = pending || busy !== null || !ownerAuthorized;

  return (
    <section className={JOURNEY_CARD} aria-labelledby={reading ? undefined : "consent-title"} aria-busy={pending || busy !== null}>
      {reading ? (
        // The tap was accepted: a dedicated, calm reading state replaces the choice — nothing to tap twice.
        <ReadingStatusPanel summary={t(SET_SUMMARY_KEY[setKind])} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 id="consent-title" className="text-xl font-semibold text-primary">
              {t("vehicleRegConsentTitle")}
            </h2>
            {/* A PDF only reaches this step when its text could not be read locally — say so. */}
            {(intent === "complete" || setKind === "PDF") && <p className="text-sm text-foreground/70">{intent === "complete" ? t("vehicleRegConsentIntroComplete") : setKind === "PDF" ? t("vehicleRegConsentIntroPdf") : t("vehicleRegConsentIntro")}</p>}
            <p className="text-base text-foreground">{t("vehicleRegConsentDisclosure")}</p>
          </div>

          {mode === "stale" && <Alert variant="warning">{t("vehicleRegConsentStaleNotice")}</Alert>}

          {/* Three short reassurances — what this step does NOT do. */}
          <ul className="flex flex-col gap-2.5 rounded-2xl bg-secondary/5 p-4">
            {TRUST_KEYS.map((key) => (
              <li key={key} className="flex items-start gap-2.5 text-sm text-foreground">
                <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden className="mt-0.5 shrink-0 text-secondary-700" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>

          {/* Layered privacy information — short and neutral; the full disclosure is the linked policy section. */}
          <div className="flex flex-col gap-1">
            <details className="group rounded-2xl border border-border" open={mode === "stale"}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <ShieldCheck size={18} strokeWidth={1.75} aria-hidden className="text-foreground/60" />
                  {t("vehicleRegConsentDetailsToggle")}
                </span>
                <ChevronDown size={18} strokeWidth={1.75} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm text-foreground/80">
                <p>{t("vehicleRegConsentDetailsExternal")}</p>
                <p>{t("vehicleRegConsentLimits")}</p>
                <p className="text-foreground/70">{t("vehicleRegConsentLegalNote")}</p>
              </div>
            </details>
            <Link href={AUTOMATIC_READING_POLICY_HREF} className="inline-flex min-h-11 items-center self-start rounded text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("vehicleRegConsentPrivacyPolicyLink")}
            </Link>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-border p-4 text-base text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
            <input type="checkbox" checked={ownerAuthorized} onChange={(e) => setOwnerAuthorized(e.target.checked)} disabled={pending || busy !== null} className="mt-0.5 size-6 shrink-0 accent-primary" />
            <span>{t("vehicleRegConsentOwnerLabel")}</span>
          </label>

          {errorCode && <Alert variant="danger">{td(registrationReviewMessageKey(errorCode))}</Alert>}

          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => run("read")} disabled={readDisabled} aria-disabled={readDisabled} aria-describedby={!ownerAuthorized ? "consent-needs-authorization" : undefined} className={`${JOURNEY_PRIMARY} w-full`}>
              <ScanLine size={20} strokeWidth={1.75} aria-hidden />
              {t("vehicleRegConsentReadButton")}
            </button>
            {!ownerAuthorized && (
              <p id="consent-needs-authorization" className="text-center text-sm text-foreground/70">
                {t("vehicleJourneyConsentNeedsAuthorization")}
              </p>
            )}
            <button type="button" onClick={() => run("manual")} disabled={pending || busy !== null} className={`${JOURNEY_TERTIARY} w-full`}>
              <PencilLine size={18} strokeWidth={1.75} aria-hidden />
              {busy === "manual" ? t("vehicleRegConsentPending") : t("vehicleRegConsentManualButton")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
