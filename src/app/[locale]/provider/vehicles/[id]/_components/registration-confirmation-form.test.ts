import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Vehicle-DETAIL confirmation form — parity with the onboarding review (2026-10-12). This suite has no
// DOM, so the contract is asserted structurally; the behaviour itself is proven on the shared pure
// rules (review-field-state.test.ts) both forms use through ONE hook and ONE set of field helpers.

const ROOT = process.cwd();
const strip = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
const FORM = strip("src/app/[locale]/provider/vehicles/[id]/_components/registration-confirmation-form.tsx");
const ONBOARDING = strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
const SECTION = strip("src/components/provider/registration-review-section.tsx");
const HOOK = strip("src/components/provider/registration-review/use-review-field-state.ts");
const ACTIONS = strip("src/app/[locale]/provider/vehicles/[id]/registration-actions.ts");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = (l: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", l, "provider.json"), "utf8")) as Record<string, string>;

describe("ONE shared field-state contract for both forms", () => {
  it("the detail form and the onboarding review use the SAME hook and the SAME field helpers — no second copy of the rules", () => {
    for (const src of [FORM, ONBOARDING]) {
      expect(src).toMatch(/useReviewFieldState\(\{ vehicleId, fields, sourceToken: suggestionSourceToken \}\)/);
      expect(src).toMatch(/<FieldStatusAndSuggestion field=\{f\} label=\{label\} status=\{status\} value=\{values\[f\.key\]\} pending=\{pending\} onApply=\{\(\) => applyFieldSuggestion\(f\)\} inputId=\{`(rf|of)-\$\{f\.key\}`\} \/>/);
      expect(src).toContain("<FieldConflictAndComparison field={f} status={status} value={values[f.key]} revealed={isRevealed} pending={pending} onChoose={(v) => typeInto(f.key, v)} />");
      expect(src).toMatch(/const status = fieldState\.status\(f\);/);
      // neither form keeps its own copy of the starting-value / status / storage rules any more
      expect(src).not.toMatch(/function initialValue\(|confirmedValue \?\? f\.extractedValue|STATUS_LABEL_KEY|APPLIED_STORAGE_PREFIX \+|syncUntouchedValues\(|decodeAppliedSuggestions\(/);
    }
  });

  it("the detail section passes the opaque source-reading token, so remembered suggestions never outlive their reading", () => {
    expect(SECTION).toContain("suggestionSourceToken={review.lastSucceededAt ? review.lastSucceededAt.toISOString() : null}");
  });
});

describe("detail form — save authority, failure, discard", () => {
  it("nothing is persisted except through the existing session-derived Save draft / Submit actions; success settles the temporary state", () => {
    expect(FORM).toMatch(/const action = mode === "SUBMIT" \? submitRegistrationConfirmationAction : saveRegistrationDraftAction;/);
    expect(FORM).toMatch(/if \(res\.ok\) \{\s*fieldState\.settle\(\);\s*router\.refresh\(\);/);
    expect(ACTIONS).toMatch(/writeRegistrationConfirmation\(mode, vehicleId, values\)/);
    expect(ACTIONS).toMatch(/ForbiddenError\) return \{ ok: false, code: "VEHICLE_NOT_FOUND" \}/); // non-enumerating
  });

  it("15. a failed save keeps every value, marks the field invalid and opens + scrolls to a private field", () => {
    expect(FORM).toMatch(/setErrorCode\(res\.code\);\s*if \(res\.fieldErrors\) setFieldErrors\(res\.fieldErrors\);/);
    expect(FORM).not.toMatch(/fieldState\.discard\(\)[\s\S]{0,80}res\.code/); // an error never discards
    expect(FORM).toMatch(/setPrivateOpen\(true\);/);
    expect(FORM).toMatch(/scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/);
    expect(FORM).toMatch(/aria-invalid=\{err \? true : undefined\}/);
  });

  it("17. 'Discard changes' drops unsaved edits locally (no action, no request) and only appears when something changed", () => {
    expect(FORM).toMatch(/const discardChanges = \(\) => \{\s*setErrorCode\(null\);\s*setFieldErrors\(\[\]\);\s*fieldState\.discard\(\);\s*\};/);
    expect(FORM).toMatch(/\{fieldState\.dirty && \(\s*<button type="button" onClick=\{discardChanges\}/);
    expect(HOOK).toMatch(/const discard = \(\) => \{[\s\S]*?forgetStored\(\);[\s\S]*?\};/);
  });

  it("after 'Use <suggestion>' focus moves to the filled field (the button itself disappears)", () => {
    const ASSIST = strip("src/components/provider/registration-review/field-assist.tsx");
    expect(ASSIST).toMatch(/const apply = \(\) => \{\s*onApply\(\);\s*requestAnimationFrame\(\(\) => document\.getElementById\(inputId\)\?\.focus\(\)\);\s*\};/);
    expect(ASSIST).toMatch(/<button type="button" onClick=\{apply\}/);
    expect(FORM).toContain("inputId={`rf-${f.key}`}");
    expect(FORM).toMatch(/id=\{`rf-\$\{f\.key\}`\}/);
  });

  it("the provider's values are typed through the shared handler (never the suggestion silently)", () => {
    expect(FORM).toMatch(/onChange=\{\(e\) => typeInto\(f\.key, e\.target\.value\)\}/);
  });
});

describe("detail form — privacy, dates, capacity, type, layout", () => {
  it("private details start COLLAPSED (mounted, hidden) with a status summary; sensitive values stay masked until revealed", () => {
    expect(FORM).toMatch(/const \[privateOpen, setPrivateOpen\] = useState\(false\);/);
    expect(FORM).toMatch(/<div id="rf-private-section" hidden=\{!privateOpen\} className=\{privateOpen \? "flex flex-col" : "hidden"\}>/);
    expect(FORM).toMatch(/aria-expanded=\{privateOpen\} aria-controls="rf-private-section"/);
    expect(FORM).toMatch(/f\.sensitive && !isRevealed/);
    expect(FORM).toMatch(/const \[revealed, setRevealed\] = useState<Record<string, boolean>>\(\{\}\);/);
  });

  it("20. dates are typed as DD/MM/YYYY in an LTR isolate and submitted as canonical ISO", () => {
    expect(FORM).toMatch(/kinds\[k\] === "date" \? dateFieldSubmissionValue\(v\) : v/);
    expect(FORM).toMatch(/dir=\{isDate \? "ltr" : undefined\}/);
    expect(FORM).toMatch(/\[unicode-bidi:isolate\]/);
    expect(FORM).toMatch(/placeholder=\{isDate \? DATE_INPUT_PLACEHOLDER : undefined\}/);
    expect(FORM).not.toMatch(/type="date"/);
  });

  it("18/19. the claim has no vehicle-type control (type stays on the edit page) and no capacity is derived on the client", () => {
    expect(FORM).not.toMatch(/vehicleType|setVehicleType|<select/);
    expect(FORM).not.toMatch(/licensedPassengerCapacity\s*[-+*]|registeredSeats\s*[-+*]/);
  });

  it("the actions are sticky above the phone toolbar (safe-area aware); spacing is logical (RTL-safe)", () => {
    expect(FORM).toMatch(/sticky bottom-0/);
    expect(FORM).toMatch(/safe-area-inset-bottom/);
    expect(FORM).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect((FORM.match(/<button[\s\S]*?>/g) ?? []).every((b) => b.includes('type="button"'))).toBe(true);
  });

  it("a locked (submitted) claim is read-only: no inputs, no apply, no conflict chooser", () => {
    expect(FORM).toMatch(/\{locked \? \(\s*<p className="text-sm text-foreground">/);
  });

  it("imports nothing server-side and never logs or tracks a value", () => {
    expect(FORM).not.toMatch(/@\/lib\/db|process\.env|claude-vision-reader|extract-registration-service|console\.|sendBeacon|localStorage/);
  });
});

describe("copy — every language", () => {
  it.each(LOCALES)("%s has 'Current value' and 'Discard changes'", (l) => {
    const m = messages(l);
    expect(m.vehicleRegStatusCurrent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(m.vehicleRegDiscardChanges?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("Arabic and English wording", () => {
    expect(messages("ar").vehicleRegStatusCurrent).toBe("القيمة الحالية");
    expect(messages("en").vehicleRegStatusCurrent).toBe("Current value");
    expect(messages("en").vehicleRegDiscardChanges).toBe("Discard changes");
  });
});
