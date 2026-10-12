"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { regFieldLabelKey, maskSensitiveValue, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";
import { dateFieldSubmissionValue, DATE_INPUT_PLACEHOLDER } from "@/lib/vehicles/registration-review/date-display";
import type { ConfirmationFieldError } from "@/lib/vehicles/registration-review/confirmation-input";
import { useReviewFieldState } from "@/components/provider/registration-review/use-review-field-state";
import { FieldStatusAndSuggestion, FieldConflictAndComparison } from "@/components/provider/registration-review/field-assist";
import { saveRegistrationDraftAction, submitRegistrationConfirmationAction } from "../registration-actions";

// Phase 3C Slice 3A — provider confirmation form on the vehicle DETAIL page (client). Since the
// 2026-10-12 parity correction it uses the SAME field-state contract and helpers as the onboarding
// review (use-review-field-state.ts over review-field-state.ts; field-assist.tsx):
//
//   • the provider's SAVED claim stays filled and reads "القيمة الحالية / Current value" unless it is
//     the document's current value (then the existing document wording) — a saved value is never
//     re-labelled "entered by you", which the stored record cannot prove;
//   • a DERIVED make / model suggestion is not pre-filled: "اقتراح النظام: Mazda [استخدام Mazda]"
//     fills only that input locally — no save, no server action, no request; it is offered only while
//     the input is blank, so it never overwrites a saved or typed value;
//   • a blank field is never "entered by you"; typing makes the value the provider's;
//   • conflict values are offered, never chosen; the document value stays visible for comparison;
//   • untouched fields follow new server data (a re-analysis, a save); applied suggestions survive a
//     language switch for the same reading; "Discard changes" drops unsaved edits without saving;
//   • private details start collapsed; a server error on a private field opens them and scrolls to it.
// Nothing is persisted until "Save draft" / "Submit" through the session-derived, owner-scoped
// actions; the server validates every save. The vehicle TYPE is not part of this claim.

export type FieldView = {
  key: ConfirmationFieldKey;
  group: "CUSTOMER" | "PRIVATE";
  kind: "text" | "int" | "date" | "vin" | "plate";
  sensitive: boolean;
  required: boolean;
  extractedValue: string | number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  confirmedValue: string | number | null;
  decision: { matches: boolean; source: "EXTRACTED" | "PROVIDER" | "MANUAL" } | null;
  /** Where the value comes from (read model) — the status contract decides the wording. */
  source: "NATIVE_PDF_TEXT" | "OCR" | "PROVIDER" | "UNRESOLVED";
  needsReview: boolean;
  conflict?: boolean;
  alternatives?: (string | number)[];
  heuristic?: boolean;
  completedAutomatically?: boolean;
};

type Props = {
  vehicleId: string;
  fields: FieldView[];
  canConfirm: boolean;
  locked: boolean;
  /** Opaque marker of the current source reading (applied suggestions are restored only for it). */
  suggestionSourceToken?: string | null;
};

const INPUT_CLASS = "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const ACTION = "inline-flex min-h-11 items-center rounded-full px-5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function RegistrationConfirmationForm({ vehicleId, fields, canConfirm, locked, suggestionSourceToken = null }: Props) {
  const t = useTranslations("provider");
  // Localized escape for DYNAMICALLY-BUILT message keys (field labels, result codes) — every such key
  // is guaranteed to exist by the translation-completeness parity test.
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fieldState = useReviewFieldState({ vehicleId, fields, sourceToken: suggestionSourceToken });
  const { values, typeInto, applyFieldSuggestion } = fieldState;
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [declaration, setDeclaration] = useState(false);
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ConfirmationFieldError[]>([]);
  const [privateOpen, setPrivateOpen] = useState(false);
  const privateRef = useRef<HTMLDivElement>(null);

  const customer = useMemo(() => fields.filter((f) => f.group === "CUSTOMER"), [fields]);
  const privateFields = useMemo(() => fields.filter((f) => f.group === "PRIVATE"), [fields]);
  const pendingPrivate = privateFields.filter((f) => f.required && (values[f.key] ?? "").trim() === "").length;

  // A server-reported error on a private field (or the capacity chain) opens the private section and
  // brings the first affected input into view. The provider's values are never reset.
  useEffect(() => {
    if (fieldErrors.length === 0) return;
    const privateKeys = new Set(privateFields.map((f) => f.key as string));
    const first = fieldErrors.find((e) => privateKeys.has(e.field) || e.field === "capacity");
    if (!first) return;
    setPrivateOpen(true);
    const id = first.field === "capacity" ? "rf-licensedPassengerCapacity" : `rf-${first.field}`;
    window.setTimeout(() => (document.getElementById(id) ?? privateRef.current)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  }, [fieldErrors, privateFields]);

  const run = (mode: "DRAFT" | "SUBMIT") => {
    setErrorCode(null);
    setFieldErrors([]);
    const kinds = Object.fromEntries(fields.map((f) => [f.key, f.kind])) as Record<string, FieldView["kind"]>;
    const payload: Record<string, unknown> = { ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, kinds[k] === "date" ? dateFieldSubmissionValue(v) : v])), declarationAccepted: declaration };
    startTransition(async () => {
      const action = mode === "SUBMIT" ? submitRegistrationConfirmationAction : saveRegistrationDraftAction;
      const res = await action(vehicleId, payload);
      if (res.ok) {
        // Saved: the saved values become the starting point; temporary tab state is cleared.
        fieldState.settle();
        router.refresh();
        return;
      }
      setErrorCode(res.code);
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      // The document was replaced mid-edit: the stale claim was superseded server-side. Reload so the
      // form reflects the fresh extraction (never the stale values).
      if (res.code === "SUPERSEDED") router.refresh();
    });
  };

  /** Drop every unsaved change (nothing is sent; the vehicle and the saved claim are untouched). */
  const discardChanges = () => {
    setErrorCode(null);
    setFieldErrors([]);
    fieldState.discard();
  };

  const fieldErrorFor = (key: string): ConfirmationFieldError | undefined => fieldErrors.find((e) => e.field === key);

  const renderField = (f: FieldView) => {
    const label = td(regFieldLabelKey(f.key));
    const err = fieldErrorFor(f.key);
    const isRevealed = revealed[f.key] === true;
    const isDate = f.kind === "date";
    const inputType = f.kind === "int" ? "number" : "text";
    const status = fieldState.status(f);

    return (
      <div key={f.key} className="flex flex-col gap-1.5 py-3 border-t border-border first:border-t-0">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`rf-${f.key}`} className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            {label}
            {f.required && <span className="text-danger"> *</span>}
          </label>
          {f.decision && (
            <span className={`text-[11px] ${f.decision.matches ? "text-foreground/50" : "text-primary"}`}>
              {f.decision.source === "MANUAL" ? t("vehicleRegDecisionManual") : f.decision.matches ? t("vehicleRegDecisionMatches") : t("vehicleRegDecisionCorrected")}
            </span>
          )}
        </div>
        {locked ? (
          <p className="text-sm text-foreground">{f.sensitive && !isRevealed ? maskSensitiveValue(values[f.key] ?? "") || "—" : values[f.key] || "—"}</p>
        ) : (
          <>
            {/* ONE compact status row + the one-tap make/model suggestion (shared with onboarding). */}
            <FieldStatusAndSuggestion field={f} label={label} status={status} value={values[f.key]} pending={pending} onApply={() => applyFieldSuggestion(f)} inputId={`rf-${f.key}`} />
            {isDate && <p className="text-xs text-foreground/60">{t("vehicleRegDateFormatHint")}</p>}
            {/* Conflict choices + the document value for comparison (shared with onboarding). */}
            <FieldConflictAndComparison field={f} status={status} value={values[f.key]} revealed={isRevealed} pending={pending} onChoose={(v) => typeInto(f.key, v)} />
            {f.sensitive && !isRevealed ? (
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">{maskSensitiveValue(values[f.key] ?? "") || "—"}</p>
                <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: true }))} className="inline-flex min-h-11 items-center gap-1 text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                  <Eye size={14} aria-hidden /> {t("vehicleRegRevealButton")}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  id={`rf-${f.key}`}
                  type={inputType}
                  inputMode={isDate || f.kind === "int" ? "numeric" : undefined}
                  dir={isDate ? "ltr" : undefined}
                  placeholder={isDate ? DATE_INPUT_PLACEHOLDER : undefined}
                  value={values[f.key] ?? ""}
                  onChange={(e) => typeInto(f.key, e.target.value)}
                  disabled={pending}
                  aria-invalid={err ? true : undefined}
                  className={`${INPUT_CLASS} ${isDate ? "[unicode-bidi:isolate] text-start" : ""}`}
                />
                {f.sensitive && (
                  <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: false }))} className="inline-flex min-h-11 items-center gap-1 text-xs text-foreground/60 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <EyeOff size={14} aria-hidden /> {t("vehicleRegHideButton")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {err && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {errorCode && <Alert variant="danger">{td(registrationReviewMessageKey(errorCode))}</Alert>}
      {fieldErrors.some((e) => e.field === "capacity") && <Alert variant="danger">{t("vehicleRegCapacityError")}</Alert>}

      <Card hoverLift={false}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("vehicleRegGroupCustomer")}</h3>
        <div className="flex flex-col">{customer.map(renderField)}</div>
      </Card>

      <Card hoverLift={false}>
        <div ref={privateRef} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t("vehicleRegGroupPrivate")}</h3>
            <button type="button" onClick={() => setPrivateOpen((o) => !o)} aria-expanded={privateOpen} aria-controls="rf-private-section" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {privateOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              {privateOpen ? t("vehicleRegPrivateToggleHide") : t("vehicleRegPrivateToggleShow")}
            </button>
          </div>
          <p className="text-xs text-foreground/50">{t("vehicleRegGroupPrivateHint")}</p>
          {!locked && (
            <p className={`text-xs ${pendingPrivate > 0 ? "font-medium text-accent-foreground" : "text-foreground/60"}`} role="status">
              {pendingPrivate > 0 ? td("vehicleRegPrivatePending", { count: pendingPrivate }) : t("vehicleRegPrivateComplete")}
            </p>
          )}
        </div>
        {/* Collapsed by default; the fields stay MOUNTED so nothing is dropped and errors can target them. */}
        <div id="rf-private-section" hidden={!privateOpen} className={privateOpen ? "flex flex-col" : "hidden"}>
          {privateFields.map(renderField)}
        </div>
      </Card>

      {!locked && canConfirm && (
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:p-4">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
            <span>{t("vehicleRegDeclaration")}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => run("DRAFT")} disabled={pending} className={`${ACTION} border border-border`}>
              {pending ? t("vehicleRegSaving") : t("vehicleRegSaveDraftButton")}
            </button>
            <button type="button" onClick={() => run("SUBMIT")} disabled={pending || !declaration} className={`${ACTION} bg-primary text-primary-foreground`}>
              {pending ? t("vehicleRegSubmitting") : t("vehicleRegSubmitButton")}
            </button>
            {fieldState.dirty && (
              <button type="button" onClick={discardChanges} disabled={pending} className={`${ACTION} text-foreground/70 hover:bg-accent`}>
                {t("vehicleRegDiscardChanges")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
