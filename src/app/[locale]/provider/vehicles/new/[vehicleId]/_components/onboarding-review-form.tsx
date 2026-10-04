"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { regFieldLabelKey, maskSensitiveValue, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { onboardingMessageKey, type OnboardingCode, type OnboardingFieldError } from "@/lib/vehicles/onboarding/onboarding-result";
import type { VehicleTypeOption } from "@/lib/vehicles/vehicle-type-options";
import { clearOnboardingRequestKey, safeSessionStorage } from "@/lib/vehicles/onboarding/onboarding-request-key-store";
import { finalizeVehicleAction, saveOnboardingDraftAction, cancelOnboardingAction } from "../onboarding-actions";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2/3 (review & confirm),
// client island. The parser's suggestions PREFILL the inputs but are never silently accepted: the
// provider reviews/corrects every field, chooses the vehicle type (a confident suggestion is
// pre-selected, always overridable), and accepts the accuracy declaration to create the vehicle.
// A scanned/image upload yields no suggestions — the same form is then the manual-entry path (NO
// OCR). Sensitive identifiers (plate/VIN/engine) are masked with an explicit reveal. No value ever
// enters a URL/metadata; every mutation goes through the session-derived, owner-scoped actions.

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

type Props = {
  vehicleId: string;
  fields: FieldView[];
  vehicleTypeOptions: VehicleTypeOption[];
  suggestedVehicleType: string | null;
  isManual: boolean;
};

// scroll-mb keeps a focused control clear of the mobile browser toolbar / on-screen keyboard.
const INPUT_CLASS =
  "min-h-11 w-full scroll-mb-40 scroll-mt-24 rounded-lg border border-border bg-background px-3 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

// The two capacity facts are easy to confuse — each gets its own plain-language hint.
const FIELD_HINT_KEY: Partial<Record<ConfirmationFieldKey, "vehicleOnboardRegisteredSeatsHint" | "vehicleOnboardBookableHint">> = {
  registeredSeats: "vehicleOnboardRegisteredSeatsHint",
  bookablePassengerCapacity: "vehicleOnboardBookableHint",
};

function initialValue(f: FieldView): string {
  const v = f.confirmedValue ?? f.extractedValue;
  return v === null || v === undefined ? "" : String(v);
}

export function OnboardingReviewForm({ vehicleId, fields, vehicleTypeOptions, suggestedVehicleType, isManual }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string) => string; // dynamic field-label/confidence/result keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initialValue(f)])));
  const [vehicleType, setVehicleType] = useState<string>(suggestedVehicleType ?? "");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [declaration, setDeclaration] = useState(false);
  const [errorCode, setErrorCode] = useState<OnboardingCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldError[]>([]);
  const [claimedFourByFour, setClaimedFourByFour] = useState(false);
  const [publicDescription, setPublicDescription] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const customer = useMemo(() => fields.filter((f) => f.group === "CUSTOMER"), [fields]);
  const privateFields = useMemo(() => fields.filter((f) => f.group === "PRIVATE"), [fields]);

  const payload = () => ({ ...values, vehicleType, claimedFourByFour, publicDescription, declarationAccepted: declaration });

  const saveDraft = () => {
    setErrorCode(null);
    setFieldErrors([]);
    startTransition(async () => {
      const res = await saveOnboardingDraftAction(vehicleId, { ...values });
      if (res.ok) {
        router.refresh();
        return;
      }
      setErrorCode(res.code as OnboardingCode);
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.code === "SUPERSEDED") router.refresh();
    });
  };

  const finalize = () => {
    setErrorCode(null);
    setFieldErrors([]);
    startTransition(async () => {
      const res = await finalizeVehicleAction(vehicleId, payload());
      if (res.ok) {
        // Created (or already created): leave the wizard for the vehicle's detail page.
        router.push(`/provider/vehicles/${vehicleId}`);
        router.refresh();
        return;
      }
      setErrorCode(res.code);
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.code === "SUPERSEDED") router.refresh();
    });
  };

  const cancel = () => {
    setErrorCode(null);
    startTransition(async () => {
      const res = await cancelOnboardingAction(vehicleId);
      if (res.ok) {
        // The setup is gone and the server keeps a CANCELLED tombstone for its request; drop the
        // browser's copy of the key so the next "add vehicle" starts a new request.
        clearOnboardingRequestKey(safeSessionStorage());
        router.push("/provider/vehicles");
        router.refresh();
        return;
      }
      setErrorCode(res.code);
    });
  };

  const fieldErrorFor = (key: string) => fieldErrors.find((e) => e.field === key);

  const renderField = (f: FieldView) => {
    const label = td(regFieldLabelKey(f.key));
    const err = fieldErrorFor(f.key);
    const isRevealed = revealed[f.key] === true;
    const inputType = f.kind === "int" ? "number" : f.kind === "date" ? "date" : "text";
    const extractedDisplay = f.extractedValue === null ? null : f.sensitive && !isRevealed ? maskSensitiveValue(String(f.extractedValue)) : String(f.extractedValue);

    return (
      <div key={f.key} className="flex flex-col gap-1.5 py-3 border-t border-border first:border-t-0">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`of-${f.key}`} className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            {label}
            {f.required && <span className="text-danger"> *</span>}
          </label>
          {f.decision && (
            <span className={`text-[11px] ${f.decision.matches ? "text-foreground/50" : "text-primary"}`}>
              {f.decision.source === "MANUAL" ? t("vehicleRegDecisionManual") : f.decision.matches ? t("vehicleRegDecisionMatches") : t("vehicleRegDecisionCorrected")}
            </span>
          )}
        </div>
        {FIELD_HINT_KEY[f.key] && <p className="text-xs text-foreground/60">{t(FIELD_HINT_KEY[f.key]!)}</p>}
        {extractedDisplay !== null && (
          <p className="text-xs text-foreground/50">
            {t("vehicleRegExtractedPrefix")}: <bdi className="text-foreground/70">{extractedDisplay}</bdi>
            {f.confidence && (
              <span className={`ms-2 ${f.confidence === "HIGH" ? "" : "font-medium text-accent-foreground"}`}>· {td(`vehicleRegConfidence${f.confidence.charAt(0)}${f.confidence.slice(1).toLowerCase()}`)}</span>
            )}
          </p>
        )}
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
              id={`of-${f.key}`}
              type={inputType}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={pending}
              className={INPUT_CLASS}
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
      {isManual && <Alert variant="info">{t("vehicleOnboardManualNotice")}</Alert>}
      {errorCode && <Alert variant="danger">{td(onboardingMessageKey(errorCode))}</Alert>}
      {fieldErrors.some((e) => e.field === "capacity") && <Alert variant="danger">{t("vehicleRegCapacityError")}</Alert>}

      <Card hoverLift={false}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("vehicleRegGroupCustomer")}</h3>
        <div className="flex flex-col gap-1.5 py-3">
          <label htmlFor="of-vehicleType" className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            {t("vehicleTypeLabel")}
            <span className="text-danger"> *</span>
          </label>
          <select
            id="of-vehicleType"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            disabled={pending}
            className={INPUT_CLASS}
          >
            <option value="">{t("vehicleTypeSelectPlaceholder")}</option>
            {vehicleTypeOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldErrorFor("vehicleType") && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
        </div>
        <div className="flex flex-col">{customer.map(renderField)}</div>
      </Card>

      <Card hoverLift={false}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("vehicleRegGroupPrivate")}</h3>
        <p className="mb-2 text-xs text-foreground/50">{t("vehicleRegGroupPrivateHint")}</p>
        <div className="flex flex-col">{privateFields.map(renderField)}</div>
      </Card>

      <Card hoverLift={false}>
        <div className="flex flex-col gap-4">
          {vehicleType === "FOUR_BY_FOUR" && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={claimedFourByFour} onChange={(e) => setClaimedFourByFour(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{t("vehicleClaimedFourByFourLabel")}</span>
                <span className="text-xs text-foreground/60">{t("vehicleClaimedFourByFourHint")}</span>
              </span>
            </label>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="of-publicDescription" className="text-xs font-medium uppercase tracking-wide text-foreground/60">
              {t("vehiclePublicDescriptionLabel")}
            </label>
            <textarea
              id="of-publicDescription"
              rows={3}
              maxLength={500}
              value={publicDescription}
              onChange={(e) => setPublicDescription(e.target.value)}
              disabled={pending}
              className={`${INPUT_CLASS} py-2`}
            />
            {fieldErrorFor("publicDescription") && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
          </div>
        </div>
      </Card>

      <Card hoverLift={false}>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
          <span>{t("vehicleOnboardDeclaration")}</span>
        </label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={finalize} disabled={pending || !declaration} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {pending ? t("vehicleOnboardCreating") : t("vehicleOnboardCreateButton")}
          </button>
          <button type="button" onClick={saveDraft} disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {pending ? t("vehicleRegSaving") : t("vehicleOnboardSaveProgressButton")}
          </button>
          {confirmingCancel ? null : (
            <button type="button" onClick={() => setConfirmingCancel(true)} disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground/70 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t("vehicleOnboardCancelButton")}
            </button>
          )}
        </div>
        {confirmingCancel && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <p className="text-sm text-foreground">{t("vehicleOnboardCancelConfirm")}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={cancel} disabled={pending} className="inline-flex min-h-11 items-center rounded-full bg-danger px-5 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
                {pending ? t("vehicleRegSaving") : t("vehicleOnboardCancelConfirmYes")}
              </button>
              <button type="button" onClick={() => setConfirmingCancel(false)} disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground/70 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t("vehicleOnboardKeepEditing")}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
