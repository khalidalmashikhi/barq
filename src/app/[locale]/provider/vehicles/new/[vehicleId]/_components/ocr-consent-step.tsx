"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ScanLine, PencilLine, ShieldCheck, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";
import { grantOcrConsentAction, declineOcrConsentAction } from "../consent-actions";

// Phase 3C (registration OCR privacy gate) — the STANDALONE processing-notice + choice step shown
// after a photo/scan (or a PDF whose text could not be read locally) is uploaded and BEFORE any
// byte may leave BARQ:
//
//   "Continue with automatic reading" → records the provider's consent (with the owner/authorized
//   attestation) and only then starts the external reading;
//   "Enter the details manually"      → records the decline; the review form is the manual path.
//
// LAYERED (2026-10-09 wording simplification): the ordinary workflow speaks of "automatic reading"
// only — a short, neutral explanation, ONE short disclosure (a copy of the document is processed,
// possibly by an external service provider outside Oman), the accuracy statement, the attestation
// and the two choices. Everything a careful provider may want to know — WHO processes it (the
// provider's legal identity), WHAT exactly is sent (the selected PDF, the photo, or ALL selected
// photos together), WHERE (outside Oman; the exact geography depends on the configured region),
// the single purpose, what automatic reading does not do, retention and the privacy policy — sits
// behind the "Privacy details" disclosure, always reachable, never hidden behind a sign-in or a
// second page. Nothing in the ordinary copy names an engine, a vendor or "AI"; nothing anywhere
// claims the processing happens only in Oman or that BARQ performs all of it.
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
  /** Where inference runs for this deployment — decides the geography sentence of the notice. */
  inferenceGeo: "us" | "global";
  /** What the stored set is — decides what the notice says is sent. */
  setKind: "PDF" | "IMAGE" | "IMAGES";
};

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

// The sentence naming what leaves BARQ — one per set kind, never a generic "your document".
const PROCESSOR_POINT_KEY = {
  PDF: "vehicleRegConsentPointProcessorPdf",
  IMAGE: "vehicleRegConsentPointProcessor",
  IMAGES: "vehicleRegConsentPointProcessorImages",
} as const;

export function OcrConsentStep({ vehicleId, mode, inferenceGeo, setKind }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // result-code message keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(mode !== "declined");
  const [ownerAuthorized, setOwnerAuthorized] = useState(false);
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);
  const [busy, setBusy] = useState<"read" | "manual" | null>(null);

  const run = (which: "read" | "manual") => {
    setErrorCode(null);
    setBusy(which);
    startTransition(async () => {
      const res = which === "read" ? await grantOcrConsentAction(vehicleId, ownerAuthorized) : await declineOcrConsentAction(vehicleId);
      setBusy(null);
      if (!res.ok) {
        setErrorCode(res.code);
        return;
      }
      // Granted → the page now shows "reading…" then the suggestions; declined → the manual form.
      router.refresh();
    });
  };

  if (!expanded) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-accent/10 px-4 py-3">
        <p className="text-sm text-foreground/80">{t("vehicleRegConsentDeclinedNotice")}</p>
        <button type="button" onClick={() => setExpanded(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ScanLine size={15} strokeWidth={1.75} aria-hidden />
          {t("vehicleRegConsentChangeMind")}
        </button>
      </div>
    );
  }

  return (
    <Card hoverLift={false}>
      <div className="flex flex-col gap-4" aria-busy={pending}>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">{t("vehicleRegConsentTitle")}</h2>
          {/* A PDF only reaches this step when its text could not be read locally — say so. */}
          <p className="text-sm text-foreground/70">{setKind === "PDF" ? t("vehicleRegConsentIntroPdf") : t("vehicleRegConsentIntro")}</p>
        </div>

        {mode === "stale" && <Alert variant="warning">{t("vehicleRegConsentStaleNotice")}</Alert>}

        {/* The short disclosure + accuracy statement: always visible, part of the ordinary workflow. */}
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-accent/10 p-4 text-sm text-foreground/80">
          <p className="flex items-start gap-2">
            <ShieldCheck size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
            <span>{t("vehicleRegConsentDisclosure")}</span>
          </p>
          <p>{t("vehicleRegConsentAccuracy")}</p>

          {/* Layered privacy information — the full notice, always reachable from here. */}
          <details className="group mt-1 rounded-xl border border-border bg-background/60" open={mode === "stale"}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <span>{t("vehicleRegConsentDetailsToggle")}</span>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
              <p className="font-medium text-foreground">{t("vehicleRegConsentNoticeTitle")}</p>
              <ul className="flex list-disc flex-col gap-1.5 ps-5">
                <li>{t(PROCESSOR_POINT_KEY[setKind])}</li>
                <li>{inferenceGeo === "us" ? t("vehicleRegConsentPointGeoUs") : t("vehicleRegConsentPointGeoGlobal")}</li>
                <li>{t("vehicleRegConsentPointPurpose")}</li>
                <li>{t("vehicleRegConsentPointAccuracy")}</li>
                <li>{t("vehicleRegConsentPointDecline")}</li>
                <li>{t("vehicleRegConsentPointRetention")}</li>
              </ul>
              <p>{t("vehicleRegConsentLimits")}</p>
              <p className="text-xs text-foreground/60">{t("vehicleRegConsentLegalNote")}</p>
              <Link href="/privacy" className="inline-flex min-h-11 items-center self-start text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("vehicleRegConsentPrivacyPolicyLink")}
              </Link>
            </div>
          </details>
        </div>

        <label className="flex items-start gap-3 text-sm text-foreground">
          <input type="checkbox" checked={ownerAuthorized} onChange={(e) => setOwnerAuthorized(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
          <span>{t("vehicleRegConsentOwnerLabel")}</span>
        </label>

        {errorCode && <Alert variant="danger">{td(registrationReviewMessageKey(errorCode))}</Alert>}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => run("read")} disabled={pending || !ownerAuthorized} className={`${BUTTON} bg-primary text-primary-foreground hover:opacity-90`}>
            <ScanLine size={16} strokeWidth={1.75} aria-hidden />
            {busy === "read" ? t("vehicleRegConsentPending") : t("vehicleRegConsentReadButton")}
          </button>
          <button type="button" onClick={() => run("manual")} disabled={pending} className={`${BUTTON} border border-border text-foreground hover:bg-accent`}>
            <PencilLine size={16} strokeWidth={1.75} aria-hidden />
            {busy === "manual" ? t("vehicleRegConsentPending") : t("vehicleRegConsentManualButton")}
          </button>
        </div>
      </div>
    </Card>
  );
}
