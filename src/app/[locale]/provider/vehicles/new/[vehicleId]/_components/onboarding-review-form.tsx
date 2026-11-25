"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, ChevronDown, ChevronUp, Lock, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
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
import type { ReviewTabBinding } from "@/lib/vehicles/registration-review/review-field-state";
import { JOURNEY_CARD, JOURNEY_CARD_TITLE, JOURNEY_CHIP_NEUTRAL, JOURNEY_CHIP_REVIEW, JOURNEY_CHIP_SUGGESTION, JOURNEY_INPUT, JOURNEY_LABEL, JOURNEY_PANEL, JOURNEY_PRIMARY, JOURNEY_SECONDARY, JOURNEY_SMALL } from "@/components/provider/vehicle-journey/journey-ui";
import { CAPACITY_CARD_KEYS, CAPACITY_SHOWN_TO_CUSTOMERS, CUSTOMER_CARD_KEYS, PRIVATE_CARD_KEYS, isCardFieldShown, reviewReadiness } from "@/components/provider/vehicle-journey/review-cards";
import { finalizeVehicleAction, saveOnboardingDraftAction, cancelOnboardingAction } from "../onboarding-actions";

// Phase 3C — Vehicle Creation from Registration, Slice 3B. Wizard step 2/3 (review & confirm),
// client island, re-cut for a 375–430 px phone (Oman field-mapping & mobile review correction,
// 2026-10-09):
//
//   0. SUMMARY (2026-11-25 step-3 clarity pass) — "N required items left", each a jump link that
//      focuses its field; required-to-create kept apart from suggestions to review (never blocking)
//   1. the page's document card (passed in as children)  2. one short automatic-reading notice
//   3. VEHICLE DETAILS — vehicle type (explicit choice; a suggestion is only offered), make, model,
//      model year, colour (customers see them once BARQ approves the vehicle)
//   3b. CAPACITY & OPERATION — licensed vs bookable defined once, side by side; each edited only here
//   4. PRIVATE registration details — collapsible, with a visible summary of the required private
//      fields still missing; a validation error opens it and scrolls to the field
//   5. optional description   6. declaration + actions (in the page flow, never pinned over fields)
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
  /** The page's document card (and its reading-failure / recovery panels), rendered right AFTER the
   *  summary of what is still missing, so that summary is the first thing on the phone screen. */
  children?: ReactNode;
};

// scroll-mb keeps a focused control clear of the mobile browser toolbar / on-screen keyboard.
const INPUT_CLASS = JOURNEY_INPUT;

// Plain-language hints for the fields that are easiest to confuse. The licensed vs bookable capacity
// difference is explained ONCE at the top of the capacity card (CAPACITY_DEFINITIONS), not per field.
const FIELD_HINT_KEY: Partial<Record<ConfirmationFieldKey, string>> = {
  model: "vehicleRegModelHint",
  modelYear: "vehicleRegModelYearHint",
  registeredSeats: "vehicleOnboardRegisteredSeatsHint",
};

/** The two passenger numbers people confuse, defined side by side at the top of the capacity card. */
const CAPACITY_DEFINITIONS: readonly { key: ConfirmationFieldKey; hintKey: string; shown: boolean }[] = [
  { key: "licensedPassengerCapacity", hintKey: "vehicleOnboardLicensedHint", shown: false },
  { key: "bookablePassengerCapacity", hintKey: "vehicleOnboardBookableHint", shown: true },
];

/** Cancel: present and reachable, but visibly the least important action (a quiet text button). */
const CANCEL_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** A jump link of the summary: looks and reads as a link, keeps a 44 px target. */
const SUMMARY_LINK =
  "inline-flex min-h-11 items-center rounded text-base font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** The fields of one card, in the card's own order. */
function fieldsInCard(fields: FieldView[], keys: readonly string[]): FieldView[] {
  return fields.filter((f) => keys.includes(f.key)).sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
}

export function OnboardingReviewForm({ vehicleId, fields, vehicleTypeOptions, suggestedVehicleType, documentDescription, noticeKey, noticeVariant, tabBinding = null, children }: Props) {
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

  // Card assignment (review-cards.ts): customer-visible · capacity & operation · private registration.
  const customer = useMemo(() => fieldsInCard(fields, CUSTOMER_CARD_KEYS), [fields]);
  const capacityFields = useMemo(() => fieldsInCard(fields, CAPACITY_CARD_KEYS), [fields]);
  const privateFields = useMemo(() => fieldsInCard(fields, PRIVATE_CARD_KEYS), [fields]);
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
    if (privateKeys.has(first.field)) setPrivateOpen(true);
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

  /** One field row. `visibility` (capacity card only) says whether customers will see the value. */
  const renderField = (f: FieldView, visibility?: "SHOWN" | "NOT_SHOWN") => {
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={`of-${f.key}`} className={JOURNEY_LABEL}>
            {label}
            {f.required && <span className="text-danger"> *</span>}
          </label>
          {visibility && <span className={visibility === "SHOWN" ? JOURNEY_CHIP_SUGGESTION : JOURNEY_CHIP_NEUTRAL}>{visibility === "SHOWN" ? t("vehicleCardShownToCustomers") : t("vehicleCardNotShownToCustomers")}</span>}
          {f.decision && (
            <span className={`ms-auto text-sm ${f.decision.matches ? "text-foreground/70" : "text-primary"}`}>
              {f.decision.source === "MANUAL" ? t("vehicleRegDecisionManual") : f.decision.matches ? t("vehicleRegDecisionMatches") : t("vehicleRegDecisionCorrected")}
            </span>
          )}
        </div>
        {f.sensitive && !isRevealed ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3">
            <p className="min-h-11 py-2.5 text-base text-foreground" dir="ltr">
              {maskSensitiveValue(values[f.key] ?? "") || "—"}
            </p>
            <button id={`of-${f.key}-reveal`} type="button" onClick={() => setRevealed((r) => ({ ...r, [f.key]: true }))} className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
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
        {/* ONE compact block: the status row (or the suggestion box with the status inside it and
            "Use suggestion" beside the value — shared with the detail form) + this field's hints. */}
        <div className="flex flex-col gap-1">
          <FieldStatusAndSuggestion field={f} label={label} status={status} value={values[f.key]} pending={pending} onApply={() => applyFieldSuggestion(f)} inputId={`of-${f.key}`} compact />
          {hintKey && <p className="text-sm text-foreground/70">{td(hintKey)}</p>}
          {isDate && <p className="text-sm text-foreground/70">{t("vehicleRegDateFormatHint")}</p>}
        </div>
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

  // The final card's summary (review-cards.ts) — informative; "Create" stays governed by canSubmit.
  const readiness = reviewReadiness({ fields, values, statusOf: (f) => fieldState.status(f), vehicleType, declaration });
  // Nothing missing yet the shared validator still refuses (an impossible date, bookable above
  // licensed…): never claim "complete" — say values need correcting. Create follows canSubmit only.
  const allComplete = readiness.missing.length === 0 && localCheck.ok;
  const invalidValues = readiness.missing.length === 0 && !localCheck.ok;
  // The values the shared validator rejects (not merely empty), so the provider can jump to each;
  // the capacity-chain rule points at the bookable capacity, the value the provider sets.
  const invalidItems: ConfirmationFieldKey[] = localCheck.ok
    ? []
    : [...new Set(localCheck.errors.filter((e) => e.code !== "REQUIRED" && e.field !== "declaration").map((e) => (e.field === "capacity" ? CAPACITY_SHOWN_TO_CUSTOMERS : e.field)))].filter((k): k is ConfirmationFieldKey => fields.some((f) => f.key === k));
  /** Take the provider to a missing item (opens the private card when the item lives there). A masked
   *  sensitive field has no input until revealed — its "Show" button takes the focus instead. */
  const goTo = (item: (typeof readiness.missing)[number] | ConfirmationFieldKey) => {
    const id = item === "vehicleType" ? "of-vehicleType" : item === "declaration" ? "of-declaration" : `of-${item}`;
    if (privateFields.some((f) => f.key === item)) setPrivateOpen(true);
    window.setTimeout(() => {
      const el = document.getElementById(id) ?? document.getElementById(`${id}-reveal`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    }, 0);
  };
  /** Fields still flagged "check this" that are NOT already listed as required-missing or invalid. */
  const reviewItems = readiness.needsReview.filter((k) => !readiness.missing.includes(k) && !invalidItems.includes(k));
  /** One jump link of the summary (a real link to the field, handled in place: no URL change). */
  const summaryLink = (item: (typeof readiness.missing)[number] | ConfirmationFieldKey) => (
    <li key={item}>
      <a
        href={`#${item === "vehicleType" ? "of-vehicleType" : item === "declaration" ? "of-declaration" : `of-${item}`}`}
        onClick={(e) => {
          e.preventDefault();
          goTo(item);
        }}
        data-summary-link=""
        data-target={item}
        className={SUMMARY_LINK}
      >
        {missingLabel(item)}
      </a>
    </li>
  );
  const missingLabel = (item: (typeof readiness.missing)[number] | ConfirmationFieldKey) =>
    item === "vehicleType" ? t("vehicleTypeLabel") : item === "declaration" ? t("vehicleCardDeclarationItem") : td(regFieldLabelKey(item));

  return (
    <div className="flex flex-col gap-5">
      {/* SUMMARY — first on the phone screen: how many required items are left, each a link to its
          field; "required to create" kept apart from "suggestions to review" (which never block).
          Computed from the same readiness + shared validator as the final card; Create stays canSubmit. */}
      <section className={`${JOURNEY_CARD} flex flex-col gap-3`} aria-labelledby="of-summary-title" data-review-summary="">
        <h2 id="of-summary-title" className="flex items-start gap-2 text-lg font-semibold text-foreground">
          {allComplete ? (
            <CheckCircle2 size={22} strokeWidth={1.9} aria-hidden className="mt-0.5 shrink-0 text-secondary-700" />
          ) : (
            <AlertTriangle size={22} strokeWidth={1.9} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          )}
          <span>{allComplete ? t("vehicleCardReadyAll") : invalidValues ? t("vehicleCardReadyInvalid") : td("vehicleReviewSummaryRemaining", { count: readiness.missing.length })}</span>
        </h2>
        {!allComplete && <p className="text-sm text-foreground/75">{t("vehicleReviewSummaryCreateHint")}</p>}
        {(readiness.missing.length > 0 || invalidItems.length > 0) && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">{t("vehicleReviewSummaryRequiredTitle")}</p>
            {readiness.missing.length > 0 && <ul className="flex flex-wrap gap-x-4">{readiness.missing.map(summaryLink)}</ul>}
            {invalidItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4" data-summary-invalid="">
                <span className="text-sm text-danger">{t("vehicleCardReadyFix")}:</span>
                <ul className="flex flex-wrap gap-x-4">{invalidItems.map(summaryLink)}</ul>
              </div>
            )}
          </div>
        )}
        {reviewItems.length > 0 && (
          <div className={`flex flex-col gap-1 ${readiness.missing.length > 0 || invalidItems.length > 0 ? "border-t border-border pt-3" : ""}`}>
            <p className="text-sm font-semibold text-foreground">{t("vehicleReviewSummaryReviewTitle")}</p>
            {/* Shared guidance ONCE, not under every field. */}
            {anyNeedsReview && <p className="text-sm text-foreground/75">{t("vehicleOnboardNeedsReviewHint")}</p>}
            <ul className="flex flex-wrap gap-x-4">{reviewItems.map(summaryLink)}</ul>
          </div>
        )}
      </section>

      {children}

      {noticeKey && <Alert variant={noticeVariant}>{td(noticeKey)}</Alert>}
      {errorCode && <Alert variant="danger">{td(onboardingMessageKey(errorCode))}</Alert>}
      {fieldErrors.some((e) => e.field === "capacity") && <Alert variant="danger">{t("vehicleRegCapacityError")}</Alert>}

      {/* CARD 2 — the vehicle's details (customers see them once BARQ approves the vehicle). */}
      <section className={JOURNEY_CARD} aria-labelledby="of-customer-title">
        <div className="mb-4 flex flex-col gap-1.5">
          <h2 id="of-customer-title" className={JOURNEY_CARD_TITLE}>
            {t("vehicleCardVehicleTitle")}
          </h2>
          <p className="text-sm text-foreground/75">{t("vehicleCardCustomerHint")}</p>
        </div>

        {documentDescription && (
          // The printed description, for comparison — private and visually secondary.
          <div className={`${JOURNEY_PANEL} mb-4 flex flex-col gap-1.5`}>
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground/75">
              <Lock size={14} strokeWidth={1.75} aria-hidden />
              {t("vehicleRegDocumentDescriptionLabel")}
            </p>
            <p className="text-base font-medium text-foreground">
              <bdi>{documentDescription}</bdi>
            </p>
            <p className="text-sm text-foreground/75">{t("vehicleRegDocumentDescriptionHint")}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 pb-4">
          <label htmlFor="of-vehicleType" className={JOURNEY_LABEL}>
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-secondary/30 bg-secondary/5 px-3 py-2">
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
              <p className="text-sm text-foreground/75">{t("vehicleRegTypeMustChoose")}</p>
            </>
          ) : (
            <p className="text-sm text-foreground/75">{t("vehicleRegTypeChosenNote")}</p>
          )}
          {fieldErrorFor("vehicleType") && (
            <p id="of-vehicleType-error" className="text-sm font-medium text-danger">
              {t("vehicleRegFieldError")}
            </p>
          )}
        </div>
        <div className="flex flex-col border-t border-border pt-4">{customer.map((f) => renderField(f))}</div>
      </section>

      {/* CARD 3 — capacity and operation: the ONLY place each capacity is edited. The licensed vs
          bookable difference is defined once, side by side, above the inputs. */}
      <section className={JOURNEY_CARD} aria-labelledby="of-capacity-title">
        <div className="mb-4 flex flex-col gap-3">
          <h2 id="of-capacity-title" className={JOURNEY_CARD_TITLE}>
            {t("vehicleCardCapacityTitle")}
          </h2>
          <dl className={`${JOURNEY_PANEL} flex flex-col gap-3`} data-capacity-definitions="">
            {CAPACITY_DEFINITIONS.map((d) => (
              <div key={d.key} className="flex flex-col gap-0.5">
                <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                  {td(regFieldLabelKey(d.key))}
                  <span className={d.shown ? JOURNEY_CHIP_SUGGESTION : JOURNEY_CHIP_NEUTRAL}>{d.shown ? t("vehicleCardShownToCustomers") : t("vehicleCardNotShownToCustomers")}</span>
                </dt>
                <dd className="text-sm text-foreground/75">{td(d.hintKey)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-col">
          {capacityFields.filter((f) => isCardFieldShown(f, values[f.key])).map((f) => renderField(f, f.key === CAPACITY_SHOWN_TO_CUSTOMERS ? "SHOWN" : "NOT_SHOWN"))}
        </div>
        {vehicleType === "FOUR_BY_FOUR" && (
          <label className="mt-2 flex items-start gap-3 rounded-2xl border border-border p-4 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
            <input type="checkbox" checked={claimedFourByFour} onChange={(e) => setClaimedFourByFour(e.target.checked)} disabled={pending} className="mt-0.5 size-6 shrink-0 accent-primary" />
            <span className="flex flex-col">
              <span className="text-base text-foreground">{t("vehicleClaimedFourByFourLabel")}</span>
              <span className="text-sm text-foreground/75">{t("vehicleClaimedFourByFourHint")}</span>
            </span>
          </label>
        )}
      </section>

      {/* CARD 4 — PRIVATE REGISTRATION DETAILS — collapsed by default, never dropped, summary always visible. */}
      <section className={JOURNEY_CARD} aria-labelledby="of-private-title">
        <div ref={privateRef} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="of-private-title" className={`flex items-center gap-2 ${JOURNEY_CARD_TITLE}`}>
              <Lock size={18} strokeWidth={1.75} aria-hidden className="text-foreground/60" />
              {t("vehicleRegGroupPrivate")}
            </h2>
            <span role="status" className={pendingPrivate > 0 ? JOURNEY_CHIP_REVIEW : JOURNEY_CHIP_SUGGESTION}>
              {pendingPrivate > 0 ? td("vehicleRegPrivatePending", { count: pendingPrivate }) : t("vehicleRegPrivateComplete")}
            </span>
          </div>
          <p className="text-sm text-foreground/80">{t("vehicleCardPrivateNote")}</p>
          <button type="button" onClick={() => setPrivateOpen((o) => !o)} aria-expanded={privateOpen} aria-controls="of-private-section" className={`${JOURNEY_SMALL} self-start`}>
            {privateOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
            {privateOpen ? t("vehicleRegPrivateToggleHide") : t("vehicleRegPrivateToggleShow")}
          </button>
        </div>
        {/* Collapsed = display:none via the class (a utility `flex` would override the `hidden`
            attribute); the fields stay MOUNTED so nothing is dropped and errors can target them. */}
        <div id="of-private-section" hidden={!privateOpen} className={privateOpen ? "mt-4 flex flex-col border-t border-border pt-4" : "hidden"}>
          {privateFields.map((f) => renderField(f))}
        </div>
      </section>

      {/* CARD 5 — OPTIONAL DESCRIPTION — compact; customers see it once the vehicle is approved. */}
      <section className={`${JOURNEY_CARD} flex flex-col gap-2`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor="of-publicDescription" className={JOURNEY_LABEL}>
            {t("vehicleCardDescriptionTitle")}
          </label>
          <span className={JOURNEY_CHIP_SUGGESTION}>{t("vehicleCardShownToCustomers")}</span>
        </div>
        <textarea
          id="of-publicDescription"
          rows={2}
          maxLength={500}
          value={publicDescription}
          onChange={(e) => setPublicDescription(e.target.value)}
          disabled={pending}
          placeholder={t("vehicleCardDescriptionPlaceholder")}
          aria-describedby={fieldErrorFor("publicDescription") ? "of-publicDescription-error" : undefined}
          className={`${INPUT_CLASS} py-2.5 placeholder:text-foreground/50`}
        />
        {fieldErrorFor("publicDescription") && (
          <p id="of-publicDescription-error" className="text-sm font-medium text-danger">
            {t("vehicleRegFieldError")}
          </p>
        )}
      </section>

      {/* CARD 6 — FINAL REVIEW: what is done, what is missing, what still needs a look — then the declaration. */}
      <section className={`${JOURNEY_CARD} flex flex-col gap-4`} aria-labelledby="of-final-title">
        <h2 id="of-final-title" className={JOURNEY_CARD_TITLE}>
          {t("vehicleCardFinalTitle")}
        </h2>
        <div className="flex flex-col gap-3" data-readiness="">
          <p id="of-readiness-status" className="flex items-center gap-2 text-base font-medium text-foreground">
            {allComplete ? (
              <CheckCircle2 size={20} strokeWidth={1.9} aria-hidden className="shrink-0 text-secondary-700" />
            ) : (
              <AlertTriangle size={20} strokeWidth={1.9} aria-hidden className="shrink-0 text-warning" />
            )}
            <span>{allComplete ? t("vehicleCardReadyAll") : invalidValues ? t("vehicleCardReadyInvalid") : td("vehicleCardReadyCompleted", { done: readiness.completed, total: readiness.total })}</span>
          </p>
          {readiness.missing.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-semibold text-foreground">{t("vehicleCardReadyMissing")}</p>
              <ul className="flex flex-wrap gap-2">
                {readiness.missing.map((item) => (
                  <li key={item}>
                    <button type="button" onClick={() => goTo(item)} className={JOURNEY_SMALL}>
                      {missingLabel(item)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {invalidItems.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-3" data-invalid-items="">
              <p className="text-sm font-semibold text-foreground">{t("vehicleCardReadyFix")}</p>
              <ul className="flex flex-wrap gap-2">
                {invalidItems.map((item) => (
                  <li key={item}>
                    <button type="button" onClick={() => goTo(item)} className={JOURNEY_SMALL}>
                      {missingLabel(item)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {readiness.needsReview.length > 0 && <p className="text-sm text-foreground/80">{td("vehicleCardReadyReview", { count: readiness.needsReview.length })}</p>}
        </div>
        <label className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4 text-base text-foreground has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
          <input id="of-declaration" type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} disabled={pending} className="mt-0.5 size-6 shrink-0 accent-primary" />
          <span>{t("vehicleOnboardDeclaration")}</span>
        </label>
      </section>

      {/* ACTIONS — in the page flow on every viewport (2026-11-25): a bar pinned to the phone's bottom
          covered ~130 px of a 812 px screen while scrolling, more with the keyboard open. One primary
          action (Create), a quiet secondary (Save progress) and a low-emphasis Cancel. Create's
          disabled reason is the final card's readiness line just above (aria-describedby). */}
      <div data-review-actions="" className="flex flex-col gap-3 border-t border-border pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-4 sm:rounded-3xl sm:border sm:bg-card sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <button type="button" onClick={finalize} disabled={!canSubmit} aria-describedby={canSubmit ? undefined : "of-readiness-status"} className={`${JOURNEY_PRIMARY} w-full sm:w-auto sm:min-w-56`}>
            {pending ? t("vehicleOnboardCreating") : t("vehicleOnboardCreateButton")}
          </button>
          <button type="button" onClick={() => saveDraft()} disabled={pending} className={`${JOURNEY_SECONDARY} w-full sm:w-auto`}>
            {pending ? t("vehicleRegSaving") : t("vehicleOnboardSaveProgressButton")}
          </button>
          {confirmingCancel ? null : (
            <button type="button" onClick={() => setConfirmingCancel(true)} disabled={pending} className={`${CANCEL_LINK} self-center sm:ms-auto`}>
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
      </div>

      <UnsavedLanguageDialog open={languageGuard.target !== null} pending={pending} onStay={languageGuard.stay} onSaveAndSwitch={() => saveDraft(languageGuard.continueToTarget)} />
    </div>
  );
}
