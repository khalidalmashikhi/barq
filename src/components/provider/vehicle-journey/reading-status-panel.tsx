"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";

// 2026-10-16 — the calm "reading the document" state, shared by the consent step (right after the
// provider taps) and the processing page (another request holds the reading). A softly pulsing
// document mark (still under prefers-reduced-motion), the approved copy, and what is being read.
// No percentage, no invented stages, no action button — nothing here can start a request.

export function ReadingStatusPanel({ summary }: { summary?: string | null }) {
  const t = useTranslations("provider");
  return (
    <div role="status" aria-live="polite" data-reading-panel="" className="flex flex-col items-center gap-4 px-2 py-6 text-center">
      <span aria-hidden className="relative flex size-16 items-center justify-center rounded-2xl bg-secondary/10 text-secondary-700">
        <span className="absolute inset-0 rounded-2xl ring-2 ring-secondary/40 motion-safe:animate-ping" />
        <FileText size={30} strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="text-lg font-semibold text-foreground">{t("vehicleRegConsentReadingPending")}</p>
        <p className="text-sm text-foreground/70">{t("vehicleRegConsentReadingHint")}</p>
      </div>
      {summary && (
        <p className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm text-foreground/80">
          <FileText size={16} strokeWidth={1.75} aria-hidden />
          <span>{summary}</span>
        </p>
      )}
    </div>
  );
}
