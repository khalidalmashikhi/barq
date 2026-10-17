"use client";

import { useTranslations } from "next-intl";
import { maskSensitiveValue } from "@/lib/vehicles/registration-review/field-model";
import { formatIsoDateForDisplay } from "@/lib/vehicles/registration-review/date-display";
import {
  canApplySuggestion,
  describesDocument,
  isFlaggedForReview,
  statusLabelKey,
  suggestionText,
  type ReviewFieldStateInput,
  type ReviewFieldStatus,
} from "@/lib/vehicles/registration-review/review-field-state";

// Phase 3C (detail/onboarding parity, 2026-10-12) — the per-field review metadata BOTH registration
// forms render (onboarding review + vehicle-detail confirmation), so their wording and behaviour
// cannot drift. Each form keeps its own input, hints and layout; these render around them:
//
//   FieldStatusAndSuggestion — ONE compact status row (truthful status · confidence · "check this" ·
//     derived / completed chips) and, for a blank make / model with a document suggestion, the
//     "اقتراح النظام: Mazda  [استخدام Mazda]" row: a real type="button" whose accessible name carries
//     the field and the value, calling ONLY the form's local apply (no save, no server action).
//   FieldConflictAndComparison — the document showed several values: nothing is chosen, each value is
//     offered (masked when sensitive) and one tap puts it in the input; and, once the field holds a
//     different value, the document's value stays visible for comparison.

export type AssistField = ReviewFieldStateInput & {
  sensitive: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  needsReview: boolean;
  conflict?: boolean;
  alternatives?: (string | number)[];
};

// 2026-10-16 visual checkpoint: teal = document-assisted suggestion, amber = genuinely needs review
// (the "check this" chips and a conflict the provider must resolve).
const CHIP = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
const CHOICE = "inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm text-foreground hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";
const APPLY = "inline-flex min-h-11 max-w-full items-center rounded-xl border border-primary/30 bg-card px-4 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

type Td = (key: string, values?: Record<string, string | number>) => string;

export function FieldStatusAndSuggestion({ field: f, label, status, value, pending, onApply, inputId }: { field: AssistField; label: string; status: ReviewFieldStatus; value: string | undefined; pending: boolean; onApply: () => void; inputId: string }) {
  const t = useTranslations("provider");
  const td = t as unknown as Td;
  const onDocument = describesDocument(status);
  const flagged = isFlaggedForReview(f, status);
  const suggestion = suggestionText(f);
  const offerApply = canApplySuggestion(f, value) && suggestion !== null;
  // the button disappears once the field is filled — hand focus to that field so keyboard / screen-reader
  // users land on the value they just chose instead of the top of the document
  const apply = () => {
    onApply();
    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  };
  const confidenceKey = f.confidence ? `vehicleRegConfidence${f.confidence.charAt(0)}${f.confidence.slice(1).toLowerCase()}` : null;
  return (
    <>
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground/70">
        <span data-field-status={status}>{td(statusLabelKey(status, f.source))}</span>
        {onDocument && confidenceKey && f.extractedValue !== null && <span aria-label={td(confidenceKey)}>· {td(confidenceKey)}</span>}
        {flagged && <span className={`${CHIP} bg-warning/15 text-foreground`}>{t("vehicleOnboardNeedsReviewBadge")}</span>}
        {f.heuristic && onDocument && <span className={`${CHIP} bg-warning/15 text-foreground`}>{t("vehicleRegHeuristicBadge")}</span>}
        {f.completedAutomatically && onDocument && <span className={`${CHIP} bg-warning/15 text-foreground`}>{t("vehicleRegCompletedBadge")}</span>}
      </p>
      {offerApply && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-secondary/30 bg-secondary/5 px-3 py-2">
          <span className="min-w-0 text-sm text-secondary-700">
            {t("vehicleRegExtractedPrefix")}: <bdi className="font-medium text-foreground">{suggestion}</bdi>
          </span>
          <button type="button" onClick={apply} disabled={pending} aria-label={td("vehicleRegUseSuggestionAria", { field: label, value: suggestion! })} className={APPLY}>
            <span className="truncate">{td("vehicleRegUseSuggestion", { value: suggestion! })}</span>
          </button>
        </div>
      )}
    </>
  );
}

export function FieldConflictAndComparison({ field: f, status, value, revealed, pending, onChoose }: { field: AssistField; status: ReviewFieldStatus; value: string | undefined; revealed: boolean; pending: boolean; onChoose: (value: string) => void }) {
  const t = useTranslations("provider");
  const isDate = f.kind === "date";
  const show = (v: string | number) => (f.sensitive && !revealed ? maskSensitiveValue(String(v)) : isDate ? formatIsoDateForDisplay(String(v)) : String(v));
  const changed = status === "PROVIDER" || status === "CURRENT";
  const showConflict = f.conflict === true && (f.alternatives?.length ?? 0) > 0 && status !== "PROVIDER";
  // The document's value stays visible for comparison once the field holds something else (typed,
  // saved earlier, or cleared where there is no one-tap action).
  const suggestion = suggestionText(f);
  const showComparison = f.extractedValue !== null && suggestion !== null && value !== suggestion && (changed || (status === "SUGGESTED" && !canApplySuggestion(f, value)));
  return (
    <>
      {showConflict && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-semibold text-foreground">{t("vehicleRegConflictLabel")}</p>
          <p className="text-xs text-foreground/70">{t("vehicleRegConflictHint")}</p>
          <div className="flex flex-wrap gap-2">
            {f.alternatives!.map((alt, i) => (
              <button key={`${f.key}-alt-${i}`} type="button" onClick={() => onChoose(isDate ? formatIsoDateForDisplay(String(alt)) : String(alt))} disabled={pending} className={CHOICE}>
                <bdi dir={isDate ? "ltr" : undefined} className="font-medium">{show(alt)}</bdi>
                <span className="text-xs text-foreground/70">{t("vehicleRegConflictChoose")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {showComparison && (
        <p className="text-xs text-foreground/70">
          {t("vehicleRegExtractedPrefix")}: <bdi dir={isDate ? "ltr" : undefined} className="text-foreground/70">{show(f.extractedValue!)}</bdi>
        </p>
      )}
    </>
  );
}
