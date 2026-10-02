"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import {
  CONFIRMATION_FIELDS,
  regFieldLabelKey,
  maskSensitiveValue,
  type ConfirmationFieldKey,
} from "@/lib/vehicles/registration-review/field-model";
import { registrationReviewMessageKey, type RegistrationReviewCode } from "@/lib/vehicles/registration-review/registration-review-result";
import type { ConfirmationFieldError } from "@/lib/vehicles/registration-review/confirmation-input";
import { saveRegistrationDraftAction, submitRegistrationConfirmationAction } from "../registration-actions";

// Phase 3C Slice 3A — provider confirmation form (client). Extracted suggestions prefill inputs but
// are never silently accepted — the provider confirms/corrects + accepts a declaration to SUBMIT.
// Sensitive identifiers (VIN/plate/engine) are masked by default with an explicit reveal control.
// Never puts a value in a URL/metadata/toast; all mutations go through the session-derived actions.

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
};

type Props = { vehicleId: string; fields: FieldView[]; canConfirm: boolean; locked: boolean };

function initialValue(f: FieldView): string {
  const v = f.confirmedValue ?? f.extractedValue;
  return v === null || v === undefined ? "" : String(v);
}

export function RegistrationConfirmationForm({ vehicleId, fields, canConfirm, locked }: Props) {
  const t = useTranslations("provider");
  // Localized escape for DYNAMICALLY-BUILT message keys (field labels, confidence, result codes) —
  // every such key is guaranteed to exist by the translation-completeness parity test. Literal keys
  // keep next-intl's strict type-checking via `t(...)`.
  const td = t as unknown as (key: string) => string;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initialValue(f)])));
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [declaration, setDeclaration] = useState(false);
  const [errorCode, setErrorCode] = useState<RegistrationReviewCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ConfirmationFieldError[]>([]);

  const customer = useMemo(() => fields.filter((f) => f.group === "CUSTOMER"), [fields]);
  const privateFields = useMemo(() => fields.filter((f) => f.group === "PRIVATE"), [fields]);

  const run = (mode: "DRAFT" | "SUBMIT") => {
    setErrorCode(null);
    setFieldErrors([]);
    const payload: Record<string, unknown> = { ...values, declarationAccepted: declaration };
    startTransition(async () => {
      const action = mode === "SUBMIT" ? submitRegistrationConfirmationAction : saveRegistrationDraftAction;
      const res = await action(vehicleId, payload);
      if (res.ok) {
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

  const fieldErrorFor = (key: string): ConfirmationFieldError | undefined => fieldErrors.find((e) => e.field === key);

  const renderField = (f: FieldView) => {
    const label = td(regFieldLabelKey(f.key));
    const err = fieldErrorFor(f.key);
    const isRevealed = revealed[f.key] === true;
    const inputType = f.kind === "int" ? "number" : f.kind === "date" ? "date" : "text";
    const extractedDisplay = f.extractedValue === null ? null : f.sensitive && !isRevealed ? maskSensitiveValue(String(f.extractedValue)) : String(f.extractedValue);

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
        {extractedDisplay !== null && (
          <p className="text-xs text-foreground/50">
            {t("vehicleRegExtractedPrefix")}: <span className="text-foreground/70">{extractedDisplay}</span>
            {f.confidence && <span className="ms-2">· {td(`vehicleRegConfidence${f.confidence.charAt(0)}${f.confidence.slice(1).toLowerCase()}`)}</span>}
          </p>
        )}
        {locked ? (
          <p className="text-sm text-foreground">{f.sensitive && !isRevealed ? maskSensitiveValue(values[f.key] ?? "") || "—" : values[f.key] || "—"}</p>
        ) : f.sensitive && !isRevealed ? (
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
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={pending}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            {f.sensitive && (
              <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: false }))} className="inline-flex min-h-11 items-center gap-1 text-xs text-foreground/60 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <EyeOff size={14} aria-hidden /> {t("vehicleRegHideButton")}
              </button>
            )}
          </div>
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
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("vehicleRegGroupPrivate")}</h3>
        <p className="mb-2 text-xs text-foreground/50">{t("vehicleRegGroupPrivateHint")}</p>
        <div className="flex flex-col">{privateFields.map(renderField)}</div>
      </Card>

      {!locked && canConfirm && (
        <Card hoverLift={false}>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
            <span>{t("vehicleRegDeclaration")}</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => run("DRAFT")} disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {pending ? t("vehicleRegSaving") : t("vehicleRegSaveDraftButton")}
            </button>
            <button type="button" onClick={() => run("SUBMIT")} disabled={pending || !declaration} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {pending ? t("vehicleRegSubmitting") : t("vehicleRegSubmitButton")}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
