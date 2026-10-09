"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { regFieldLabelKey, maskSensitiveValue, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { parseConfirmation } from "@/lib/vehicles/registration-review/confirmation-input";
import { formatIsoDateForDisplay, dateFieldSubmissionValue, DATE_INPUT_PLACEHOLDER } from "@/lib/vehicles/registration-review/date-display";
import { onboardingMessageKey, type OnboardingCode, type OnboardingFieldError } from "@/lib/vehicles/onboarding/onboarding-result";
import type { VehicleTypeOption } from "@/lib/vehicles/vehicle-type-options";
import { clearOnboardingRequestKey, safeSessionStorage } from "@/lib/vehicles/onboarding/onboarding-request-key-store";
import { finalizeVehicleAction, saveOnboardingDraftAction, cancelOnboardingAction } from "../onboarding-actions";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2/3 (review & confirm),
// client island, re-cut for a 375–430 px phone (Oman field-mapping & mobile review correction,
// 2026-10-09):
//
//   1. (previews are above, on the page)  2. one short automatic-reading notice
//   3. CUSTOMER-VISIBLE details — vehicle type (explicit choice; a suggestion is only offered),
//      make, model, model year, colour, bookable passengers
//   4. PRIVATE registration details — collapsible, with a visible summary of the required private
//      fields still missing; a validation error opens it and scrolls to the field
//   5. optional description   6. declaration + actions (sticky above the phone toolbar)
//
// The parser's suggestions PREFILL the inputs but are never silently accepted: every field carries
// ONE compact metadata row (source · confidence · "check"), a value DERIVED from the document's
// compound description is flagged as such, a field printed with two different values arrives
// UNRESOLVED with its alternatives, dates are shown and typed as unambiguous DD/MM/YYYY in an LTR
// isolate while the canonical ISO value is what gets submitted, and sensitive identifiers
// (plate / VIN / engine) stay masked until revealed. The vehicle TYPE is never pre-selected: the
// provider taps the suggestion or picks from the list; the choice survives a reload or a language
// switch (session storage, per vehicle) without touching the server. "Create" stays disabled until
// the submission validates locally, the type is chosen and the declaration is ticked. No value ever
// enters a URL, log or analytics; every mutation goes through the session-derived actions.

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
  /** Where the starting value came from (document text, OCR, the provider, or nothing). */
  source: "NATIVE_PDF_TEXT" | "OCR" | "PROVIDER" | "UNRESOLVED";
  /** Read without certainty, flagged, or required but missing — the provider must look at it. */
  needsReview: boolean;
  /** The document showed different values for this field; `alternatives` lists them (private). */
  conflict?: boolean;
  alternatives?: (string | number)[];
  /** Derived from the document's compound description (dictionary split) — must be confirmed. */
  heuristic?: boolean;
};

const SOURCE_LABEL_KEY = {
  NATIVE_PDF_TEXT: "vehicleRegSourceDocument",
  OCR: "vehicleRegSourceOcr",
  PROVIDER: "vehicleRegSourceProvider",
  UNRESOLVED: "vehicleRegSourceUnresolved",
} as const;

type Props = {
  vehicleId: string;
  fields: FieldView[];
  vehicleTypeOptions: VehicleTypeOption[];
  /** A body-style suggestion for the type — OFFERED, never pre-selected. */
  suggestedVehicleType: string | null;
  /** The compound vehicle description exactly as printed (private), or null. */
  documentDescription: string | null;
  /** Localized notice shown above the fields (manual entry / failure reason / OCR caution), or null. */
  noticeKey: string | null;
  noticeVariant: "info" | "warning";
};

// scroll-mb keeps a focused control clear of the mobile browser toolbar / on-screen keyboard.
const INPUT_CLASS =
  "min-h-11 w-full scroll-mb-40 scroll-mt-24 rounded-lg border border-border bg-background px-3 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const CHIP = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

// Plain-language hints for the fields that are easiest to confuse.
const FIELD_HINT_KEY: Partial<Record<ConfirmationFieldKey, string>> = {
  model: "vehicleRegModelHint",
  modelYear: "vehicleRegModelYearHint",
  licensedPassengerCapacity: "vehicleOnboardLicensedHint",
  registeredSeats: "vehicleOnboardRegisteredSeatsHint",
  bookablePassengerCapacity: "vehicleOnboardBookableHint",
};

const TYPE_STORAGE_PREFIX = "barq:vehicle-onboarding:type:";

function initialValue(f: FieldView): string {
  const v = f.confirmedValue ?? f.extractedValue;
  if (v === null || v === undefined) return "";
  // Dates are stored and submitted as ISO; the provider SEES and types day/month/year.
  return f.kind === "date" ? formatIsoDateForDisplay(String(v)) : String(v);
}

export function OnboardingReviewForm({ vehicleId, fields, vehicleTypeOptions, suggestedVehicleType, documentDescription, noticeKey, noticeVariant }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string; // dynamic field-label/confidence/result keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initialValue(f)])));
  // The TYPE starts UNCHOSEN. A previous explicit choice for this vehicle (reload / language
  // switch) is restored from the tab's session storage after mount — never from a suggestion.
  const [vehicleType, setVehicleTypeState] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [declaration, setDeclaration] = useState(false);
  const [errorCode, setErrorCode] = useState<OnboardingCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldError[]>([]);
  const [claimedFourByFour, setClaimedFourByFour] = useState(false);
  const [publicDescription, setPublicDescription] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const privateRef = useRef<HTMLDivElement>(null);

  const customer = useMemo(() => fields.filter((f) => f.group === "CUSTOMER"), [fields]);
  const privateFields = useMemo(() => fields.filter((f) => f.group === "PRIVATE"), [fields]);
  const kindOf = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.kind])) as Record<string, FieldView["kind"]>, [fields]);

  useEffect(() => {
    // Restore ONLY an explicit earlier choice (no action is called here; nothing is submitted).
    try {
      const stored = window.sessionStorage.getItem(TYPE_STORAGE_PREFIX + vehicleId);
      if (stored && vehicleTypeOptions.some((o) => o.code === stored)) setVehicleTypeState(stored);
    } catch {
      /* storage unavailable — the provider simply chooses again */
    }
  }, [vehicleId, vehicleTypeOptions]);

  const setVehicleType = (code: string) => {
    setVehicleTypeState(code);
    try {
      if (code) window.sessionStorage.setItem(TYPE_STORAGE_PREFIX + vehicleId, code);
      else window.sessionStorage.removeItem(TYPE_STORAGE_PREFIX + vehicleId);
    } catch {
      /* ignore */
    }
  };
  const forgetStoredType = () => {
    try {
      window.sessionStorage.removeItem(TYPE_STORAGE_PREFIX + vehicleId);
    } catch {
      /* ignore */
    }
  };

  // What the server receives: dates converted from the displayed day/month/year to canonical ISO.
  const submissionValues = (): Record<string, string> =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, kindOf[k] === "date" ? dateFieldSubmissionValue(v) : v]));
  const payload = () => ({ ...submissionValues(), vehicleType, claimedFourByFour, publicDescription, declarationAccepted: declaration });

  // The same pure validator the server runs, used only to decide whether "Create" may be pressed.
  const localCheck = useMemo(() => parseConfirmation({ ...submissionValues(), declarationAccepted: declaration }, "SUBMIT"), [values, declaration]); // eslint-disable-line react-hooks/exhaustive-deps
  const canSubmit = localCheck.ok && vehicleType !== "" && declaration && !pending;

  const pendingPrivate = privateFields.filter((f) => f.required && (values[f.key] ?? "").trim() === "").length;
  const anyNeedsReview = useMemo(() => fields.some((f) => f.needsReview), [fields]);

  // A server-reported error on a private field (or the capacity chain) opens the private section
  // and brings the first affected input into view.
  useEffect(() => {
    if (fieldErrors.length === 0) return;
    const privateKeys = new Set(privateFields.map((f) => f.key as string));
    const first = fieldErrors.find((e) => privateKeys.has(e.field) || e.field === "capacity");
    if (!first) return;
    setPrivateOpen(true);
    const id = first.field === "capacity" ? "of-licensedPassengerCapacity" : `of-${first.field}`;
    window.setTimeout(() => (document.getElementById(id) ?? privateRef.current)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  }, [fieldErrors, privateFields]);

  const saveDraft = () => {
    setErrorCode(null);
    setFieldErrors([]);
    startTransition(async () => {
      const res = await saveOnboardingDraftAction(vehicleId, submissionValues());
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
    if (!canSubmit) return;
    setErrorCode(null);
    setFieldErrors([]);
    startTransition(async () => {
      const res = await finalizeVehicleAction(vehicleId, payload());
      if (res.ok) {
        // Created (or already created): leave the wizard for the vehicle's detail page.
        forgetStoredType();
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
        forgetStoredType();
        router.push("/provider/vehicles");
        router.refresh();
        return;
      }
      setErrorCode(res.code);
    });
  };

  const fieldErrorFor = (key: string) => fieldErrors.find((e) => e.field === key);
  const confidenceKey = (c: NonNullable<FieldView["confidence"]>) => `vehicleRegConfidence${c.charAt(0)}${c.slice(1).toLowerCase()}`;

  const renderField = (f: FieldView) => {
    const label = td(regFieldLabelKey(f.key));
    const err = fieldErrorFor(f.key);
    const isRevealed = revealed[f.key] === true;
    const isDate = f.kind === "date";
    const inputType = f.kind === "int" ? "number" : "text";
    // Once the provider changes a value it is theirs: the "check this" flag and the document
    // source label describe the STARTING value only.
    const edited = (values[f.key] ?? "") !== initialValue(f);
    const source = edited ? "PROVIDER" : f.source;
    const flagged = f.needsReview && !edited;
    const extractedDisplay =
      f.extractedValue === null ? null : f.sensitive && !isRevealed ? maskSensitiveValue(String(f.extractedValue)) : isDate ? formatIsoDateForDisplay(String(f.extractedValue)) : String(f.extractedValue);
    const hintKey = FIELD_HINT_KEY[f.key];

    return (
      <div key={f.key} className="flex flex-col gap-1.5 border-t border-border py-3 first:border-t-0">
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
        {/* ONE compact metadata row: source · confidence · check — never three separate lines. */}
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/50">
          <span>{t(SOURCE_LABEL_KEY[source])}</span>
          {!edited && f.confidence && f.extractedValue !== null && <span aria-label={td(confidenceKey(f.confidence))}>· {td(confidenceKey(f.confidence))}</span>}
          {flagged && <span className={`${CHIP} bg-accent/20 text-accent-foreground`}>{t("vehicleOnboardNeedsReviewBadge")}</span>}
          {f.heuristic && !edited && <span className={`${CHIP} bg-warning/15 text-foreground`}>{t("vehicleRegHeuristicBadge")}</span>}
        </p>
        {hintKey && <p className="text-xs text-foreground/60">{td(hintKey)}</p>}
        {isDate && <p className="text-xs text-foreground/60">{t("vehicleRegDateFormatHint")}</p>}
        {f.conflict && (f.alternatives?.length ?? 0) > 0 && !edited && (
          // CONFLICT: the document itself disagrees. Nothing was chosen; every value it showed is
          // offered (masked like any sensitive value) and ONE tap puts it in the input — the
          // provider can still overrule it by typing.
          <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3">
            <p className="text-xs font-medium text-accent-foreground">{t("vehicleRegConflictLabel")}</p>
            <p className="text-xs text-foreground/70">{t("vehicleRegConflictHint")}</p>
            <div className="flex flex-wrap gap-2">
              {f.alternatives!.map((alt, i) => (
                <button
                  key={`${f.key}-alt-${i}`}
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, [f.key]: isDate ? formatIsoDateForDisplay(String(alt)) : String(alt) }))}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                >
                  <bdi dir={isDate ? "ltr" : undefined} className="font-medium">{f.sensitive && !isRevealed ? maskSensitiveValue(String(alt)) : isDate ? formatIsoDateForDisplay(String(alt)) : String(alt)}</bdi>
                  <span className="text-xs text-foreground/60">{t("vehicleRegConflictChoose")}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* The original suggestion stays visible only once the provider has changed the value. */}
        {edited && extractedDisplay !== null && (
          <p className="text-xs text-foreground/50">
            {t("vehicleRegExtractedPrefix")}: <bdi dir={isDate ? "ltr" : undefined} className="text-foreground/70">{extractedDisplay}</bdi>
          </p>
        )}
        {f.sensitive && !isRevealed ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground">{maskSensitiveValue(values[f.key] ?? "") || "—"}</p>
            <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: true }))} className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <Eye size={14} aria-hidden /> {t("vehicleRegRevealButton")}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              id={`of-${f.key}`}
              type={inputType}
              inputMode={isDate || f.kind === "int" ? "numeric" : undefined}
              dir={isDate ? "ltr" : undefined}
              placeholder={isDate ? DATE_INPUT_PLACEHOLDER : undefined}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              disabled={pending}
              aria-invalid={err ? true : undefined}
              className={`${INPUT_CLASS} ${isDate ? "[unicode-bidi:isolate] text-start" : ""}`}
            />
            {f.sensitive && (
              <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: false }))} className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <EyeOff size={14} aria-hidden /> {t("vehicleRegHideButton")}
              </button>
            )}
          </div>
        )}
        {err && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
      </div>
    );
  };

  const suggestedOption = suggestedVehicleType ? (vehicleTypeOptions.find((o) => o.code === suggestedVehicleType) ?? null) : null;

  return (
    <div className="flex flex-col gap-4 pb-28">
      {noticeKey && <Alert variant={noticeVariant}>{td(noticeKey)}</Alert>}
      {anyNeedsReview && <p className="text-xs text-foreground/70">{t("vehicleOnboardNeedsReviewHint")}</p>}
      {errorCode && <Alert variant="danger">{td(onboardingMessageKey(errorCode))}</Alert>}
      {fieldErrors.some((e) => e.field === "capacity") && <Alert variant="danger">{t("vehicleRegCapacityError")}</Alert>}

      {/* 3. CUSTOMER-VISIBLE DETAILS */}
      <Card hoverLift={false}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">{t("vehicleRegGroupCustomer")}</h3>
        {documentDescription && (
          <div className="mb-2 rounded-xl border border-border bg-accent/10 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/60">{t("vehicleRegDocumentDescriptionLabel")}</p>
            <p className="mt-1 text-sm text-foreground"><bdi>{documentDescription}</bdi></p>
            <p className="mt-1 text-xs text-foreground/60">{t("vehicleRegDocumentDescriptionHint")}</p>
          </div>
        )}
        <div className="flex flex-col gap-1.5 py-3">
          <label htmlFor="of-vehicleType" className="text-xs font-medium uppercase tracking-wide text-foreground/60">
            {t("vehicleTypeLabel")}
            <span className="text-danger"> *</span>
          </label>
          <select id="of-vehicleType" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} disabled={pending} aria-invalid={fieldErrorFor("vehicleType") ? true : undefined} className={INPUT_CLASS}>
            <option value="">{t("vehicleTypeSelectPlaceholder")}</option>
            {vehicleTypeOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          {vehicleType === "" ? (
            <>
              {suggestedOption && (
                // A body-style SUGGESTION from the document — offered, never applied by itself.
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-accent/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs text-foreground/80">
                    <Sparkles size={14} strokeWidth={1.75} aria-hidden />
                    <span>{t("vehicleRegTypeSuggestionLabel")}: <span className="font-medium text-foreground">{suggestedOption.label}</span></span>
                  </p>
                  <button type="button" onClick={() => setVehicleType(suggestedOption.code)} disabled={pending} className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                    {t("vehicleRegTypeUseSuggestion")}
                  </button>
                </div>
              )}
              <p className="text-xs text-foreground/60">{t("vehicleRegTypeMustChoose")}</p>
            </>
          ) : (
            <p className="text-[11px] text-foreground/50">{t("vehicleRegTypeChosenNote")}</p>
          )}
          {fieldErrorFor("vehicleType") && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
        </div>
        <div className="flex flex-col">{customer.map(renderField)}</div>
      </Card>

      {/* 4. PRIVATE REGISTRATION DETAILS — collapsible, never dropped, summary always visible. */}
      <Card hoverLift={false}>
        <div ref={privateRef} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t("vehicleRegGroupPrivate")}</h3>
            <button type="button" onClick={() => setPrivateOpen((o) => !o)} aria-expanded={privateOpen} aria-controls="of-private-section" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {privateOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              {privateOpen ? t("vehicleRegPrivateToggleHide") : t("vehicleRegPrivateToggleShow")}
            </button>
          </div>
          <p className="text-xs text-foreground/50">{t("vehicleRegGroupPrivateHint")}</p>
          <p className={`text-xs ${pendingPrivate > 0 ? "font-medium text-accent-foreground" : "text-foreground/60"}`} role="status">
            {pendingPrivate > 0 ? td("vehicleRegPrivatePending", { count: pendingPrivate }) : t("vehicleRegPrivateComplete")}
          </p>
        </div>
        {/* Collapsed = display:none via the class (a utility `flex` would override the `hidden`
            attribute); the fields stay MOUNTED so nothing is dropped and errors can target them. */}
        <div id="of-private-section" hidden={!privateOpen} className={privateOpen ? "flex flex-col" : "hidden"}>
          {privateFields.map(renderField)}
        </div>
      </Card>

      {/* 5. OPTIONAL DESCRIPTION + 4x4 declaration */}
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
            <textarea id="of-publicDescription" rows={3} maxLength={500} value={publicDescription} onChange={(e) => setPublicDescription(e.target.value)} disabled={pending} className={`${INPUT_CLASS} py-2`} />
            {fieldErrorFor("publicDescription") && <p className="text-xs text-danger">{t("vehicleRegFieldError")}</p>}
          </div>
        </div>
      </Card>

      {/* 6. DECLARATION + ACTIONS — sticky, clear of the phone browser's toolbar. */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:p-4">
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-1 min-h-5 min-w-5" />
          <span>{t("vehicleOnboardDeclaration")}</span>
        </label>
        {!canSubmit && !pending && <p className="text-xs text-foreground/60">{t("vehicleRegSubmitBlockedHint")}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={finalize} disabled={!canSubmit} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
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
          <div className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
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
      </div>
    </div>
  );
}
