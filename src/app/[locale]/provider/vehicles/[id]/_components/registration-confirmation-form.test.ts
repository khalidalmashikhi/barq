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
      expect(src).toMatch(/useReviewFieldState\(\{ vehicleId, fields, binding: tabBinding, flow: "(DETAIL|ONBOARDING)"/);
      expect(src).toMatch(/<FieldStatusAndSuggestion field=\{f\} label=\{label\} status=\{status\} value=\{values\[f\.key\]\} pending=\{pending\} onApply=\{\(\) => applyFieldSuggestion\(f\)\} inputId=\{`(rf|of)-\$\{f\.key\}`\} \/>/);
      expect(src).toContain("<FieldConflictAndComparison field={f} status={status} value={values[f.key]} revealed={isRevealed} pending={pending} onChoose={(v) => typeInto(f.key, v)} />");
      expect(src).toMatch(/const status = fieldState\.status\(f\);/);
      // neither form keeps its own copy of the starting-value / status / storage rules any more
      expect(src).not.toMatch(/function initialValue\(|confirmedValue \?\? f\.extractedValue|STATUS_LABEL_KEY|APPLIED_STORAGE_PREFIX \+|syncUntouchedValues\(|decodeAppliedSuggestions\(/);
    }
  });

  it("both pages pass the server's opaque tab binding (provider + reading), so remembered values never outlive their reading or owner", () => {
    expect(SECTION).toContain("tabBinding={review.tabBinding}");
    expect(strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx")).toContain("tabBinding={review.tabBinding}");
    expect(FORM).toMatch(/flow: "DETAIL", enabled: !locked/); // a submitted (locked) claim restores nothing
  });
});

describe("detail form — save authority, failure, discard", () => {
  it("nothing is persisted except through the existing session-derived Save draft / Submit actions; success settles the temporary state", () => {
    expect(FORM).toMatch(/const action = mode === "SUBMIT" \? submitRegistrationConfirmationAction : saveRegistrationDraftAction;/);
    expect(FORM).toMatch(/if \(res\.ok\) \{\s*fieldState\.settle\(\);\s*if \(afterSave\) afterSave\(\);\s*else router\.refresh\(\);/);
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
    // the shared StickyActionBar (sticky against the VIEWPORT; the page-scoped layout contract and
    // scroll-owner proof live in sticky-action-bar.test.ts)
    expect(FORM).toMatch(/<StickyActionBar className="[^"]*pb-\[max\(env\(safe-area-inset-bottom\),0\.75rem\)\]/);
    expect(FORM).not.toMatch(/className="[^"]*\bsticky bottom-0/);
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

// ── 2026-10-12 correction — language switch: tab memory for public values, guard for private ones ──
describe("language switch — no silent loss, nothing private persisted (both forms)", () => {
  const GUARD = strip("src/components/provider/registration-review/unsaved-language-guard.tsx");
  const STATE = strip("src/lib/vehicles/registration-review/review-field-state.ts");

  it("15. both forms take the SAME binding-aware hook and the SAME guard + dialog", () => {
    expect(FORM).toMatch(/useReviewFieldState\(\{ vehicleId, fields, binding: tabBinding, flow: "DETAIL", enabled: !locked \}\)/);
    expect(ONBOARDING).toMatch(/useReviewFieldState\(\{ vehicleId, fields, binding: tabBinding, flow: "ONBOARDING" \}\)/);
    expect(FORM).toMatch(/useUnsavedLanguageGuard\(!locked && canConfirm && fieldState\.privateDirty\)/);
    expect(ONBOARDING).toMatch(/useUnsavedLanguageGuard\(fieldState\.privateDirty\)/);
    for (const src of [FORM, ONBOARDING]) expect(src).toMatch(/<UnsavedLanguageDialog open=\{languageGuard\.target !== null\} pending=\{pending\} onStay=\{languageGuard\.stay\}/);
  });

  it("13. while private values are unsaved the switch is held: Stay, or save through the EXISTING save action then switch; a failed save stays", () => {
    expect(GUARD).toMatch(/registerLocaleSwitchInterceptor\(\(href\) => \{\s*setTarget\(href\);\s*return true;\s*\}\)/);
    expect(GUARD).toMatch(/if \(!active\) return;/);
    expect(FORM).toMatch(/onSaveAndSwitch=\{\(\) => run\("DRAFT", languageGuard\.continueToTarget\)\}/);
    expect(ONBOARDING).toMatch(/onSaveAndSwitch=\{\(\) => saveDraft\(languageGuard\.continueToTarget\)\}/);
    for (const src of [FORM, ONBOARDING]) expect(src).toMatch(/languageGuard\.stay\(\); \/\/ a failed save never switches language/);
    expect(GUARD).toMatch(/if \(href\) router\.push\(href\);/); // only after the save succeeded
    expect(GUARD).toMatch(/import \{ useRouter \} from "next\/navigation";/); // the target already carries its locale
  });

  it("8. a successful save clears the saved fields' tab memory (both forms); 9. Discard clears all of it; create / cancel forget everything", () => {
    expect(HOOK).toMatch(/const settle = \(\) => \{[\s\S]*?persist\(\{ fields: \{\}, extras: memoryRef\.current\.extras \}\);/);
    expect(HOOK).toMatch(/const discard = \(\) => \{[\s\S]*?forgetStored\(\);[\s\S]*?\};/);
    expect(ONBOARDING).toMatch(/if \(res\.ok\) \{\s*fieldState\.settle\(\);\s*if \(afterSave\) afterSave\(\);\s*else router\.refresh\(\);/);
    expect(FORM).toMatch(/if \(res\.ok\) \{[\s\S]{0,200}?fieldState\.settle\(\);/);
  });

  it("10/12. tab memory is THIS tab's sessionStorage only — never persistent browser storage, a cookie, the URL, a log or telemetry", () => {
    expect(HOOK).toMatch(/window\.sessionStorage\.setItem\(storageKey, encoded\)/);
    for (const src of [HOOK, FORM, ONBOARDING, GUARD]) expect(src).not.toMatch(/localStorage|indexedDB|document\.cookie|searchParams|history\.(push|replace)State|console\.|sendBeacon|analytics|track\(/);
    // the record is bound to identity + reading + form, and only allowlisted public keys are encoded
    expect(STATE).toMatch(/JSON\.stringify\(\{ v: TAB_MEMORY_VERSION, u: binding\.identity, s: binding\.source, k: flow, f, x \}\)/);
    expect(STATE).toMatch(/if \(!isTabMemoryField\(k\) \|\| !e \|\| !keepable\(e\.value\)\) continue;/);
  });

  it("14. typing, applying and restoring make no request and call no server action", () => {
    expect(HOOK).not.toMatch(/fetch\(|Action\(|from "\.\.\/|registration-actions|onboarding-actions|startTransition/);
    expect(GUARD).not.toMatch(/fetch\(|Action\(/);
  });

  it("a locked (submitted) claim restores nothing and clears any leftover memory", () => {
    expect(HOOK).toMatch(/if \(!enabled\) \{\s*window\.sessionStorage\.removeItem\(storageKey\);\s*return;\s*\}/);
  });

  it("the accuracy declaration is never remembered", () => {
    expect(STATE).not.toMatch(/TAB_MEMORY_EXTRA_KEYS[^\n]*declaration/);
  });
});

describe("language-switch prompt copy — every language", () => {
  it.each(LOCALES)("%s has the four prompt strings", (l) => {
    const m = messages(l);
    for (const k of ["vehicleRegLocaleGuardTitle", "vehicleRegLocaleGuardMessage", "vehicleRegLocaleGuardStay", "vehicleRegLocaleGuardSave"]) expect(m[k]?.trim().length ?? 0, k).toBeGreaterThan(0);
  });

  it("the approved Arabic and English message", () => {
    expect(messages("ar").vehicleRegLocaleGuardMessage).toBe("لديك تغييرات غير محفوظة. احفظ التقدم قبل تغيير اللغة حتى لا تفقدها.");
    expect(messages("en").vehicleRegLocaleGuardMessage).toBe("You have unsaved changes. Save your progress before changing language so they are not lost.");
  });
});
