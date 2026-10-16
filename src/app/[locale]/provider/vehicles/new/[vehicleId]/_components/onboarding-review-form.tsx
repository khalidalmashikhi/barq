"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, ChevronDown, ChevronUp, Lock, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { regFieldLabelKey, maskSensitiveValue, type ConfirmationFieldKey } from "@/lib/vehicles/registration-review/field-model";
import { parseConfirmation } from "@/lib/vehicles/registration-review/confirmation-input";
import { dateFieldSubmissionValue, DATE_INPUT_PLACEHOLDER } from "@/lib/vehicles/registration-review/date-display";
import { onboardingMessageKey, type OnboardingCode, type OnboardingFieldError } from "@/lib/vehicles/onboarding/onboarding-result";
import type { VehicleTypeOption } from "@/lib/vehicles/vehicle-type-options";
import { clearOnboardingRequestKey, safeSessionStorage } from "@/lib/vehicles/onboarding/onboarding-request-key-store";
import { useReviewFieldState } from "@/components/provider/registration-review/use-review-field-state";
import { FieldStatusAndSuggestion, FieldConflictAndComparison } from "@/components/provider/registration-review/field-assist";
import { useUnsavedLanguageGuard, UnsavedLanguageDialog } from "@/components/provider/registration-review/unsaved-language-guard";
import { StickyActionBar } from "@/components/provider/registration-review/sticky-action-bar";
import type { ReviewTabBinding } from "@/lib/vehicles/registration-review/review-field-state";
import { JOURNEY_CARD, JOURNEY_CHIP_REVIEW, JOURNEY_CHIP_SUGGESTION, JOURNEY_PANEL, JOURNEY_PRIMARY, JOURNEY_SECONDARY, JOURNEY_SMALL, JOURNEY_TERTIARY } from "@/components/provider/vehicle-journey/journey-ui";
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
// DIRECT document values PREFILL the inputs but are never silently accepted: every field carries
// ONE compact metadata row (a truthful status · confidence · "check" — review-field-state.ts; a
// blank field is never "entered by you"). A make / commercial model DERIVED from the document's
// compound description (or filled by the automatic completion) is NOT pre-filled: it is shown as a
// suggestion with a one-tap "Use <value>" that fills only that input locally — no save, no server
// call, never the vehicle type — and never replaces what the provider typed (2026-10-11). Fields
// the provider has not touched follow the server when the review re-renders with new data (e.g.
// after "Read document again"); applied make/model suggestions survive a language switch through
// the same per-vehicle session storage as the type choice. A field printed with two different values arrives
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
  /** Filled by the optional automatic completion of an incomplete PDF reading — must be confirmed. */
  completedAutomatically?: boolean;
};

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
  /** Opaque server binding (signed-in provider + CURRENT document reading). Unsaved public values
   *  remembered in the tab are restored only for the same provider, reading and form — never after a
   *  re-read or a replaced document. Not a value, never shown. */
  tabBinding?: ReviewTabBinding | null;
};

// scroll-mb keeps a focused control clear of the mobile browser toolbar / on-screen keyboard.
const INPUT_CLASS =
  "min-h-12 w-full scroll-mb-40 scroll-mt-24 rounded-xl border border-foreground/15 bg-card px-3 text-base focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 aria-[invalid=true]:border-danger";

// Plain-language hints for the fields that are easiest to confuse.
const FIELD_HINT_KEY: Partial<Record<ConfirmationFieldKey, string>> = {
  model: "vehicleRegModelHint",
  modelYear: "vehicleRegModelYearHint",
  licensedPassengerCapacity: "vehicleOnboardLicensedHint",
  registeredSeats: "vehicleOnboardRegisteredSeatsHint",
  bookablePassengerCapacity: "vehicleOnboardBookableHint",
};

export function OnboardingReviewForm({ vehicleId, fields, vehicleTypeOptions, suggestedVehicleType, documentDescription, noticeKey, noticeVariant, tabBinding = null }: Props) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string; // dynamic field-label/confidence/result keys (parity-guaranteed)
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // ONE shared field-state machine (use-review-field-state.ts over review-field-state.ts): a derived
  // make/model suggestion is NOT pre-filled — it is applied with an explicit tap; untouched fields
  // follow new server data; unsaved public values (typed or applied, with that origin) survive a
  // language switch for the same provider and reading. Private values never leave memory.
  const fieldState = useReviewFieldState({ vehicleId, fields, binding: tabBinding, flow: "ONBOARDING" });
  const { values, typeInto, applyFieldSuggestion, extras, setExtra } = fieldState;
  // While PRIVATE values are unsaved, a language switch asks to save progress first.
  const languageGuard = useUnsavedLanguageGuard(fieldState.privateDirty);
  // The TYPE starts UNCHOSEN. A previous explicit choice for this vehicle (reload / language switch)
  // comes back from the bound tab memory — never from a suggestion; an unknown code is ignored.
  const vehicleType = vehicleTypeOptions.some((o) => o.code === extras.vehicleType) ? extras.vehicleType! : "";
  const setVehicleType = (code: string) => setExtra("vehicleType", code);
  const claimedFourByFour = extras.claimedFourByFour === "1";
  const setClaimedFourByFour = (on: boolean) => setExtra("claimedFourByFour", on ? "1" : "");
  const publicDescription = extras.publicDescription ?? "";
  const setPublicDescription = (text: string) => setExtra("publicDescription", text);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // The accuracy declaration is never remembered: it is affirmed again after a reload / switch.
  const [declaration, setDeclaration] = useState(false);
  const [errorCode, setErrorCode] = useState<OnboardingCode | null>(null);
  const [fieldErrors, setFieldErrors] = useState<OnboardingFieldError[]>([]);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const privateRef = useRef<HTMLDivElement>(null);

  const customer = useMemo(() => fields.filter((f) => f.group === "CUSTOMER"), [fields]);
  const privateFields = useMemo(() => fields.filter((f) => f.group === "PRIVATE"), [fields]);
  const kindOf = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.kind])) as Record<string, FieldView["kind"]>, [fields]);

  /** The flow is finished or cancelled: nothing of it may come back in this tab. */
  const forgetStored = () => fieldState.forgetStored();

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

  const saveDraft = (afterSave?: () => void) => {
    setErrorCode(null);
    setFieldErrors([]);
    startTransition(async () => {
      const res = await saveOnboardingDraftAction(vehicleId, submissionValues());
      if (res.ok) {
        // Saved: the saved fields' tab memory is cleared (choices the draft does not store stay).
        fieldState.settle();
        if (afterSave) afterSave();
        else router.refresh();
        return;
      }
      languageGuard.stay(); // a failed save never switches language: the values and errors stay here
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
        forgetStored();
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
        forgetStored();
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
    const isDate = f.kind === "date";
    const inputType = f.kind === "int" ? "number" : "text";
    // The status line is derived from the CURRENT value (shared review-field-state.ts): a blank value
    // is never "entered by you"; a saved value is never re-labelled as typed.
    const status = fieldState.status(f);
    const hintKey = FIELD_HINT_KEY[f.key];
    const errorId = `of-${f.key}-error`;

    // ONE field pattern: label → value → status / suggestion → (hint) → (comparison) → (error).
    return (
      <div key={f.key} className="flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`of-${f.key}`} className="form-label">
            {label}
            {f.required && <span className="text-danger"> *</span>}
          </label>
          {f.decision && (
            <span className={`text-sm ${f.decision.matches ? "text-foreground/70" : "text-primary"}`}>
              {f.decision.source === "MANUAL" ? t("vehicleRegDecisionManual") : f.decision.matches ? t("vehicleRegDecisionMatches") : t("vehicleRegDecisionCorrected")}
            </span>
          )}
        </div>
        {f.sensitive && !isRevealed ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3">
            <p className="min-h-11 py-2.5 text-base text-foreground" dir="ltr">
              {maskSensitiveValue(values[f.key] ?? "") || "—"}
            </p>
            <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: true }))} className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <Eye size={16} aria-hidden /> {t("vehicleRegRevealButton")}
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
              onChange={(e) => typeInto(f.key, e.target.value)}
              disabled={pending}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? errorId : undefined}
              className={`${INPUT_CLASS} ${isDate ? "[unicode-bidi:isolate] text-start" : ""}`}
            />
            {f.sensitive && (
              <button type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: false }))} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded text-sm text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <EyeOff size={16} aria-hidden /> {t("vehicleRegHideButton")}
              </button>
            )}
          </div>
        )}
        {/* ONE compact metadata row + the one-tap make/model suggestion (shared with the detail form). */}
        <FieldStatusAndSuggestion field={f} label={label} status={status} value={values[f.key]} pending={pending} onApply={() => applyFieldSuggestion(f)} inputId={`of-${f.key}`} />
        {hintKey && <p className="text-sm text-foreground/70">{td(hintKey)}</p>}
        {isDate && <p className="text-sm text-foreground/70">{t("vehicleRegDateFormatHint")}</p>}
        {/* Conflict choices + the document value for comparison (shared with the detail form). */}
        <FieldConflictAndComparison field={f} status={status} value={values[f.key]} revealed={isRevealed} pending={pending} onChoose={(v) => typeInto(f.key, v)} />
        {err && (
          <p id={errorId} className="text-sm font-medium text-danger">
            {t("vehicleRegFieldError")}
          </p>
        )}
      </div>
    );
  };

  const suggestedOption = suggestedVehicleType ? (vehicleTypeOptions.find((o) => o.code === suggestedVehicleType) ?? null) : null;

  return (
    <div className="flex flex-col gap-5 pb-28">
      {noticeKey && <Alert variant={noticeVariant}>{td(noticeKey)}</Alert>}
      {errorCode && <Alert variant="danger">{td(onboardingMessageKey(errorCode))}</Alert>}
      {fieldErrors.some((e) => e.field === "capacity") && <Alert variant="danger">{t("vehicleRegCapacityError")}</Alert>}

      {/* CUSTOMER-VISIBLE DETAILS — the most important card, first. */}
      <section className={JOURNEY_CARD} aria-labelledby="of-customer-title">
        <div className="mb-4 flex flex-col gap-1.5">
          <h2 id="of-customer-title" className="text-lg font-semibold text-foreground">
            {t("vehicleRegGroupCustomer")}
          </h2>
          {/* Shared guidance ONCE, not under every field. */}
          {anyNeedsReview && <p className="text-sm text-foreground/70">{t("vehicleOnboardNeedsReviewHint")}</p>}
        </div>

        {documentDescription && (
          // The printed description, for comparison — private and visually secondary.
          <div className={`${JOURNEY_PANEL} mb-4 flex flex-col gap-1.5`}>
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground/70">
              <Lock size={14} strokeWidth={1.75} aria-hidden />
              {t("vehicleRegDocumentDescriptionLabel")}
            </p>
            <p className="text-base font-medium text-foreground">
              <bdi>{documentDescription}</bdi>
            </p>
            <p className="text-sm text-foreground/70">{t("vehicleRegDocumentDescriptionHint")}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 pb-4">
          <label htmlFor="of-vehicleType" className="form-label">
            {t("vehicleTypeLabel")}
            <span className="text-danger"> *</span>
          </label>
          <select
            id="of-vehicleType"
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            disabled={pending}
            aria-invalid={fieldErrorFor("vehicleType") ? true : undefined}
            aria-describedby={fieldErrorFor("vehicleType") ? "of-vehicleType-error" : undefined}
            className={INPUT_CLASS}
          >
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
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-secondary/30 bg-secondary/5 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm text-secondary-700">
                    <Sparkles size={16} strokeWidth={1.75} aria-hidden />
                    <span>
                      {t("vehicleRegTypeSuggestionLabel")}: <span className="font-semibold">{suggestedOption.label}</span>
                    </span>
                  </p>
                  <button type="button" onClick={() => setVehicleType(suggestedOption.code)} disabled={pending} className="inline-flex min-h-11 items-center rounded-xl border border-primary/30 bg-card px-4 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                    {t("vehicleRegTypeUseSuggestion")}
                  </button>
                </div>
              )}
              <p className="text-sm text-foreground/70">{t("vehicleRegTypeMustChoose")}</p>
            </>
          ) : (
            <p className="text-sm text-foreground/70">{t("vehicleRegTypeChosenNote")}</p>
          )}
          {fieldErrorFor("vehicleType") && (
            <p id="of-vehicleType-error" className="text-sm font-medium text-danger">
              {t("vehicleRegFieldError")}
            </p>
          )}
        </div>
        <div className="flex flex-col border-t border-border pt-4">{customer.map(renderField)}</div>
      </section>

      {/* PRIVATE REGISTRATION DETAILS — collapsed by default, never dropped, summary always visible. */}
      <section className={JOURNEY_CARD} aria-labelledby="of-private-title">
        <div ref={privateRef} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="of-private-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Lock size={18} strokeWidth={1.75} aria-hidden className="text-foreground/60" />
              {t("vehicleRegGroupPrivate")}
            </h2>
            <span role="status" className={pendingPrivate > 0 ? JOURNEY_CHIP_REVIEW : JOURNEY_CHIP_SUGGESTION}>
              {pendingPrivate > 0 ? td("vehicleRegPrivatePending", { count: pendingPrivate }) : t("vehicleRegPrivateComplete")}
            </span>
          </div>
          <p className="text-sm text-foreground/70">{t("vehicleRegGroupPrivateHint")}</p>
          <button type="button" onClick={() => setPrivateOpen((o) => !o)} aria-expanded={privateOpen} aria-controls="of-private-section" className={`${JOURNEY_SMALL} self-start`}>
            {privateOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
            {privateOpen ? t("vehicleRegPrivateToggleHide") : t("vehicleRegPrivateToggleShow")}
          </button>
        </div>
        {/* Collapsed = display:none via the class (a utility `flex` would override the `hidden`
            attribute); the fields stay MOUNTED so nothing is dropped and errors can target them. */}
        <div id="of-private-section" hidden={!privateOpen} className={privateOpen ? "mt-4 flex flex-col border-t border-border pt-4" : "hidden"}>
          {privateFields.map(renderField)}
        </div>
      </section>

      {/* OPTIONAL DESCRIPTION + 4x4 declaration */}
      <section className={JOURNEY_CARD}>
        <div className="flex flex-col gap-4">
          {vehicleType === "FOUR_BY_FOUR" && (
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={claimedFourByFour} onChange={(e) => setClaimedFourByFour(e.target.checked)} disabled={pending} className="mt-0.5 size-6 shrink-0 accent-primary" />
              <span className="flex flex-col">
                <span className="text-base text-foreground">{t("vehicleClaimedFourByFourLabel")}</span>
                <span className="text-sm text-foreground/70">{t("vehicleClaimedFourByFourHint")}</span>
              </span>
            </label>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="of-publicDescription" className="form-label">
              {t("vehiclePublicDescriptionLabel")}
            </label>
            <textarea
              id="of-publicDescription"
              rows={3}
              maxLength={500}
              value={publicDescription}
              onChange={(e) => setPublicDescription(e.target.value)}
              disabled={pending}
              aria-describedby={fieldErrorFor("publicDescription") ? "of-publicDescription-error" : undefined}
              className={`${INPUT_CLASS} py-2`}
            />
            {fieldErrorFor("publicDescription") && (
              <p id="of-publicDescription-error" className="text-sm font-medium text-danger">
                {t("vehicleRegFieldError")}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* The declaration (and why "Create" may still be disabled) sit in normal flow right above the
          actions: always reachable, read before acting — the sticky bar itself stays compact. */}
      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-base text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-0.5 size-6 shrink-0 accent-primary" />
          <span>{t("vehicleOnboardDeclaration")}</span>
        </label>
        {!canSubmit && !pending && <p className="text-sm text-foreground/70">{t("vehicleRegSubmitBlockedHint")}</p>}
      </div>

      <StickyActionBar className="-mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:mx-0 sm:rounded-3xl sm:border sm:bg-card sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <button type="button" onClick={finalize} disabled={!canSubmit} className={`${JOURNEY_PRIMARY} col-span-2 sm:min-w-56`}>
            {pending ? t("vehicleOnboardCreating") : t("vehicleOnboardCreateButton")}
          </button>
          <button type="button" onClick={() => saveDraft()} disabled={pending} className={JOURNEY_SECONDARY}>
            {pending ? t("vehicleRegSaving") : t("vehicleOnboardSaveProgressButton")}
          </button>
          {confirmingCancel ? null : (
            <button type="button" onClick={() => setConfirmingCancel(true)} disabled={pending} className={JOURNEY_TERTIARY}>
              {t("vehicleOnboardCancelButton")}
            </button>
          )}
        </div>
        {confirmingCancel && (
          <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
            <p className="text-base text-foreground">{t("vehicleOnboardCancelConfirm")}</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <button type="button" onClick={cancel} disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-danger px-5 text-base font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
                {pending ? t("vehicleRegSaving") : t("vehicleOnboardCancelConfirmYes")}
              </button>
              <button type="button" onClick={() => setConfirmingCancel(false)} disabled={pending} className={JOURNEY_SECONDARY}>
                {t("vehicleOnboardKeepEditing")}
              </button>
            </div>
          </div>
        )}
      </StickyActionBar>

      <UnsavedLanguageDialog open={languageGuard.target !== null} pending={pending} onStay={languageGuard.stay} onSaveAndSwitch={() => saveDraft(languageGuard.continueToTarget)} />
    </div>
  );
}
