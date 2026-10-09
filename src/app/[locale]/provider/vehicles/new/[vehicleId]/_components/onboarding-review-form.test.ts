import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The review form is a client island (state + server actions) and this suite has no DOM, so its
// CONTRACT is asserted structurally: document-derived values are distinguished from what the
// provider typed, uncertain or missing fields are flagged, nothing is saved before the provider
// confirms, OCR can never tick a box or choose the vehicle type on the provider's behalf, dates are
// shown day/month/year in an LTR isolate while ISO is submitted, and the phone layout groups the
// screen as specified. The eight-locale copy is checked for completeness and honesty.

const ROOT = process.cwd();
const strip = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
const FORM = strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
const DETAIL_FORM = strip("src/app/[locale]/provider/vehicles/[id]/_components/registration-confirmation-form.tsx");
const PROGRESS = strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/extraction-progress.tsx");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", locale, "provider.json"), "utf8")) as Record<string, string>;
/** The body of a `useEffect(() => { … }, [deps]);` block. */
const effects = (src: string): string[] => Array.from(src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/g)).map((m) => m[1]!);

describe("review form — sources and 'check this'", () => {
  it("every field shows where its value came from: the document, OCR, the provider, or nothing", () => {
    expect(FORM).toMatch(/NATIVE_PDF_TEXT: "vehicleRegSourceDocument"/);
    expect(FORM).toMatch(/OCR: "vehicleRegSourceOcr"/);
    expect(FORM).toMatch(/PROVIDER: "vehicleRegSourceProvider"/);
    expect(FORM).toMatch(/UNRESOLVED: "vehicleRegSourceUnresolved"/);
    expect(FORM).toMatch(/t\(SOURCE_LABEL_KEY\[source\]\)/);
  });

  it("once the provider changes a value it is THEIRS: the source becomes 'entered by you' and the flag is cleared", () => {
    expect(FORM).toMatch(/const edited = \(values\[f\.key\] \?\? ""\) !== initialValue\(f\);/);
    expect(FORM).toMatch(/const source = edited \? "PROVIDER" : f\.source;/);
    expect(FORM).toMatch(/const flagged = f\.needsReview && !edited;/);
  });

  it("ONE compact metadata row per field (source · confidence · check · derived) — not three separate lines", () => {
    const row = /<p className="flex flex-wrap items-center gap-1\.5 text-\[11px\] text-foreground\/50">[\s\S]*?<\/p>/.exec(FORM)![0];
    expect(row).toContain("t(SOURCE_LABEL_KEY[source])");
    expect(row).toContain("confidenceKey(f.confidence)");
    expect(row).toContain('t("vehicleOnboardNeedsReviewBadge")');
    expect(row).toContain('t("vehicleRegHeuristicBadge")');
    // The original suggestion is repeated only once the provider has changed the value.
    expect(FORM).toMatch(/\{edited && extractedDisplay !== null && \(/);
  });

  it("a notice (manual entry / failure reason / OCR caution) is shown above the fields, and flagged fields are explained", () => {
    expect(FORM).toMatch(/\{noticeKey && <Alert variant=\{noticeVariant\}>\{td\(noticeKey\)\}<\/Alert>\}/);
    expect(FORM).toMatch(/\{anyNeedsReview && <p[^>]*>\{t\("vehicleOnboardNeedsReviewHint"\)\}<\/p>\}/);
  });

  it("never shows raw extraction data: no JSON dump, no warnings list, no engine name; never logs or tracks a value", () => {
    expect(FORM).not.toMatch(/JSON\.stringify|<pre|rawValue|warnings|ocrEngine|documentSha256|console\.|gtag|analytics|sendBeacon/);
    expect(FORM).not.toMatch(/\?plate|\?vin|searchParams|location\.(href|search)/);
  });

  it("sensitive identifiers stay masked until the provider reveals them (21)", () => {
    expect(FORM).toMatch(/f\.sensitive && !isRevealed/);
    expect(FORM).toMatch(/maskSensitiveValue\(values\[f\.key\] \?\? ""\)/);
    expect(FORM).toMatch(/const \[revealed, setRevealed\] = useState<Record<string, boolean>>\(\{\}\);/); // nothing revealed by default
  });

  it("the document's compound description is shown privately, whole, beside the fields it explains", () => {
    expect(FORM).toMatch(/\{documentDescription && \(/);
    expect(FORM).toMatch(/t\("vehicleRegDocumentDescriptionLabel"\)/);
    expect(FORM).toMatch(/<bdi>\{documentDescription\}<\/bdi>/);
  });
});

describe("review form — nothing is finalized without the provider (8)", () => {
  it("'create vehicle' is disabled until the local validation passes, the type is chosen AND the declaration is ticked — and the box starts UNTICKED", () => {
    expect(FORM).toMatch(/const \[declaration, setDeclaration\] = useState\(false\);/);
    expect(FORM).toMatch(/const canSubmit = localCheck\.ok && vehicleType !== "" && declaration && !pending;/);
    expect(FORM).toMatch(/parseConfirmation\(\{ \.\.\.submissionValues\(\), declarationAccepted: declaration \}, "SUBMIT"\)/);
    expect(FORM).toMatch(/onClick=\{finalize\} disabled=\{!canSubmit\}/);
    expect(FORM).toMatch(/if \(!canSubmit\) return;/);
    expect(FORM).toMatch(/declarationAccepted: declaration/);
    expect(FORM).toMatch(/t\("vehicleRegSubmitBlockedHint"\)/);
  });

  it("the form only PREFILLS: the only writers are the explicit save / create / cancel actions; no effect calls an action", () => {
    expect((FORM.match(/await (saveOnboardingDraftAction|finalizeVehicleAction|cancelOnboardingAction)\(/g) ?? []).sort()).toEqual([
      "await cancelOnboardingAction(",
      "await finalizeVehicleAction(",
      "await saveOnboardingDraftAction(",
    ]);
    const bodies = effects(FORM);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) expect(body).not.toMatch(/Action\(|fetch\(|startTransition/);
  });

  it("'save progress' sends the provider's current values (dates as ISO) without the declaration — it never creates the vehicle", () => {
    expect(FORM).toMatch(/await saveOnboardingDraftAction\(vehicleId, submissionValues\(\)\)/);
    expect(FORM).not.toMatch(/saveOnboardingDraftAction\(vehicleId, payload\(\)\)/);
  });

  it("the 4x4 declaration is NEVER pre-ticked from the document — it starts false and only the provider's click changes it", () => {
    expect(FORM).toMatch(/const \[claimedFourByFour, setClaimedFourByFour\] = useState\(false\);/);
    expect((FORM.match(/setClaimedFourByFour\(/g) ?? []).length).toBe(1);
    expect(FORM).toMatch(/onChange=\{\(e\) => setClaimedFourByFour\(e\.target\.checked\)\}/);
  });
});

describe("review form — the vehicle TYPE is an explicit provider decision (3)", () => {
  it("starts UNCHOSEN; a suggestion is only OFFERED with a 'use this type' control; selecting is the provider's click", () => {
    expect(FORM).toMatch(/useState<string>\(""\)/);
    expect(FORM).not.toMatch(/useState<string>\(suggestedVehicleType/);
    expect(FORM).toMatch(/onClick=\{\(\) => setVehicleType\(suggestedOption\.code\)\}/);
    expect(FORM).toMatch(/t\("vehicleRegTypeUseSuggestion"\)/);
    expect(FORM).toMatch(/t\("vehicleRegTypeMustChoose"\)/);
    expect(FORM).toMatch(/onChange=\{\(e\) => setVehicleType\(e\.target\.value\)\}/);
    // Only the provider's two controls ever set the type (the restore effect reads an EARLIER explicit choice).
    expect((FORM.match(/setVehicleType\(/g) ?? []).length).toBe(2); // the select and the suggestion button — nothing else
    expect(FORM).toMatch(/const setVehicleType = \(code: string\) => \{/);
  });

  it("the choice survives a reload / language switch through the tab's session storage, scoped to the vehicle — never from the suggestion, never to the server", () => {
    expect(FORM).toMatch(/const TYPE_STORAGE_PREFIX = "barq:vehicle-onboarding:type:";/);
    const restore = effects(FORM).find((b) => b.includes("sessionStorage.getItem(TYPE_STORAGE_PREFIX + vehicleId)"))!;
    expect(restore).toBeTruthy();
    expect(restore).not.toMatch(/suggested/);
    expect(restore).toMatch(/vehicleTypeOptions\.some\(\(o\) => o\.code === stored\)/); // only a canonical code is restored
    expect(FORM).toMatch(/window\.sessionStorage\.setItem\(TYPE_STORAGE_PREFIX \+ vehicleId, code\)/);
    expect(FORM).not.toMatch(/localStorage/);
  });

  it("the submission carries the chosen type; without one the server refuses (finalize-vehicle.test proves REQUIRED)", () => {
    expect(FORM).toMatch(/const payload = \(\) => \(\{ \.\.\.submissionValues\(\), vehicleType, claimedFourByFour, publicDescription, declarationAccepted: declaration \}\);/);
  });
});

describe("review form — dates (6)", () => {
  it("dates are displayed and typed as DD/MM/YYYY (Western digits) in an LTR isolate; the canonical ISO is what is submitted", () => {
    expect(FORM).toMatch(/return f\.kind === "date" \? formatIsoDateForDisplay\(String\(v\)\) : String\(v\);/);
    expect(FORM).toMatch(/kindOf\[k\] === "date" \? dateFieldSubmissionValue\(v\) : v/);
    expect(FORM).toMatch(/dir=\{isDate \? "ltr" : undefined\}/);
    expect(FORM).toMatch(/placeholder=\{isDate \? DATE_INPUT_PLACEHOLDER : undefined\}/);
    expect(FORM).toMatch(/\[unicode-bidi:isolate\]/);
    expect(FORM).not.toMatch(/type="date"|"date" \? "date"/); // no native, locale-ambiguous date control
    expect(FORM).toMatch(/t\("vehicleRegDateFormatHint"\)/);
  });

  it("the vehicle-detail confirmation form applies the same date rule", () => {
    expect(DETAIL_FORM).toMatch(/formatIsoDateForDisplay\(String\(v\)\)/);
    expect(DETAIL_FORM).toMatch(/dateFieldSubmissionValue\(v\)/);
    expect(DETAIL_FORM).toMatch(/dir=\{isDate \? "ltr" : undefined\}/);
    expect(DETAIL_FORM).not.toMatch(/"date" \? "date"/);
  });
});

describe("review form — phone layout (7, 19, 20)", () => {
  it("groups the screen in the required order: notice → customer-visible (type, make, model, year, colour, bookable) → private (collapsible) → description → declaration + actions", () => {
    const order = ['t("vehicleRegGroupCustomer")', 'id="of-vehicleType"', "customer.map(renderField)", 't("vehicleRegGroupPrivate")', "privateFields.map(renderField)", 'id="of-publicDescription"', 't("vehicleOnboardDeclaration")', "onClick={finalize}"];
    const idx = order.map((s) => FORM.indexOf(s));
    for (let i = 1; i < idx.length; i++) expect(idx[i], order[i]).toBeGreaterThan(idx[i - 1]!);
  });

  it("the private section is collapsible but NEVER dropped: the fields stay mounted (hidden), and a visible summary counts the required private fields still empty", () => {
    expect(FORM).toMatch(/const \[privateOpen, setPrivateOpen\] = useState\(false\);/);
    expect(FORM).toMatch(/<div id="of-private-section" hidden=\{!privateOpen\} className=\{privateOpen \? "flex flex-col" : "hidden"\}>\s*\{privateFields\.map\(renderField\)\}/);
    expect(FORM).toMatch(/aria-expanded=\{privateOpen\} aria-controls="of-private-section"/);
    expect(FORM).toMatch(/const pendingPrivate = privateFields\.filter\(\(f\) => f\.required && \(values\[f\.key\] \?\? ""\)\.trim\(\) === ""\)\.length;/);
    expect(FORM).toMatch(/td\("vehicleRegPrivatePending", \{ count: pendingPrivate \}\) : t\("vehicleRegPrivateComplete"\)/);
    expect(FORM).toMatch(/role="status"/);
  });

  it("a validation error on a private field (or the capacity chain) opens the section and scrolls to the field; errors never clear the provider's values", () => {
    const open = effects(FORM).find((b) => b.includes("setPrivateOpen(true)"))!;
    expect(open).toBeTruthy();
    expect(open).toMatch(/e\.field === "capacity"/);
    expect(open).toMatch(/scrollIntoView/);
    expect(open).not.toMatch(/setValues/);
    expect(FORM).toMatch(/aria-invalid=\{err \? true : undefined\}/);
    // The error paths only set error state — they never reset `values`.
    const errorPaths = FORM.match(/setErrorCode\(res\.code[^\n]*\n[^\n]*setFieldErrors\(res\.fieldErrors\)/g) ?? [];
    expect(errorPaths.length).toBeGreaterThanOrEqual(2);
    expect(FORM).not.toMatch(/setValues\(\(\) => \(\{\}\)\)|setValues\(\{\}\)/);
  });

  it("the actions stay above the phone browser's toolbar (sticky, safe-area aware); spacing is logical (RTL-safe)", () => {
    expect(FORM).toMatch(/sticky bottom-0/);
    expect(FORM).toMatch(/safe-area-inset-bottom/);
    expect(FORM).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
  });
});

describe("review form — a field the document showed with TWO different values (front vs back, page 1 vs page 2)", () => {
  it("is offered as a choice: nothing is picked for the provider, one tap fills the input, typing still overrules", () => {
    expect(FORM).toMatch(/f\.conflict && \(f\.alternatives\?\.length \?\? 0\) > 0 && !edited/);
    expect(FORM).toMatch(/onClick=\{\(\) => setValues\(\(v\) => \(\{ \.\.\.v, \[f\.key\]: isDate \? formatIsoDateForDisplay\(String\(alt\)\) : String\(alt\) \}\)\)\}/);
    expect(FORM).toMatch(/t\("vehicleRegConflictChoose"\)/);
    expect(FORM).toMatch(/const v = f\.confirmedValue \?\? f\.extractedValue;/);
    expect(FORM).not.toMatch(/alternatives\?\.\[0\]|alternatives!\[0\]|alternatives\[0\]/);
  });

  it("a sensitive alternative (plate / VIN / engine) stays masked until the provider reveals it", () => {
    expect(FORM).toMatch(/f\.sensitive && !isRevealed \? maskSensitiveValue\(String\(alt\)\)/);
  });

  it("English conflict copy says none was chosen and that the provider picks or types the right value", () => {
    const en = messages("en");
    expect(en.vehicleRegConflictHint).toMatch(/none was chosen/);
    expect(en.vehicleRegConflictHint).toMatch(/type it yourself/);
  });
});

describe("'being read' state", () => {
  it("only refreshes the page on an interval, a bounded number of times — it starts no reading and sends no data", () => {
    expect(PROGRESS).toMatch(/router\.refresh\(\)/);
    expect(PROGRESS).toMatch(/if \(count >= MAX_REFRESHES\) clearInterval\(timer\)/);
    expect(PROGRESS).not.toMatch(/fetch\(|Action\(|analyze/i);
    expect(PROGRESS).toMatch(/role="status"/);
  });
});

describe("OCR review copy — complete and honest in all 8 languages", () => {
  const KEYS = [
    "vehicleRegStateProcessing", "vehicleRegExtractFailOcrUnavailable", "vehicleRegExtractFailOcrTimeout", "vehicleRegExtractFailOcrUnreadable",
    "vehicleOnboardReadingNotice", "vehicleOnboardOcrNotice", "vehicleOnboardNeedsReviewBadge", "vehicleOnboardNeedsReviewHint",
    "vehicleRegSourceDocument", "vehicleRegSourceOcr", "vehicleRegSourceProvider", "vehicleRegSourceUnresolved",
    "vehicleOnboardPreviewAlt", "vehicleOnboardFileHintOcr", "vehicleOnboardManualNotice", "vehicleOnboardDeclaration",
    "vehicleRegConflictLabel", "vehicleRegConflictHint", "vehicleRegConflictChoose", "vehicleOnboardBackPreviewAlt",
    // Oman field-mapping & mobile review correction
    "vehicleRegDocumentDescriptionLabel", "vehicleRegDocumentDescriptionHint", "vehicleRegHeuristicBadge", "vehicleRegTypeSuggestionLabel", "vehicleRegTypeUseSuggestion",
    "vehicleRegTypeMustChoose", "vehicleRegTypeChosenNote", "vehicleRegPrivateToggleShow", "vehicleRegPrivateToggleHide", "vehicleRegPrivatePending", "vehicleRegPrivateComplete",
    "vehicleRegDateFormatHint", "vehicleRegSubmitBlockedHint", "vehicleRegModelHint", "vehicleRegModelYearHint", "vehicleOnboardLicensedHint", "vehicleOnboardRegisteredSeatsHint", "vehicleOnboardBookableHint",
  ];

  it.each(LOCALES)("%s has every string, none empty", (locale) => {
    const m = messages(locale);
    for (const key of KEYS) expect(m[key], `${locale}:${key}`).toEqual(expect.stringMatching(/\S/));
  });

  it.each(LOCALES)("%s: every failure message keeps the provider moving — the document is saved and they can retry or enter the details", (locale) => {
    const m = messages(locale);
    const texts = ["vehicleRegExtractFailOcrUnavailable", "vehicleRegExtractFailOcrTimeout", "vehicleRegExtractFailOcrUnreadable"].map((k) => m[k]!);
    expect(new Set(texts).size).toBe(3);
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(40);
      expect(text).not.toMatch(/OCR_|_FAILED|undefined|\{|\}/);
    }
  });

  it.each(LOCALES)("%s: no string exposes a vendor, a model name or internal jargon to the provider", (locale) => {
    const m = messages(locale);
    for (const key of KEYS) {
      expect(m[key], key).not.toMatch(/Claude|Anthropic/i);
      expect(m[key], key).not.toMatch(/\bOCR\b|\bAI\b|\bLLM\b|JSON/);
    }
  });

  it.each(LOCALES)("%s: the capacity hints explain the three counts distinctly, the date hint shows the day/month/year example, and the pending summary interpolates a count", (locale) => {
    const m = messages(locale);
    expect(new Set([m.vehicleOnboardLicensedHint, m.vehicleOnboardRegisteredSeatsHint, m.vehicleOnboardBookableHint]).size).toBe(3);
    expect(m.vehicleRegDateFormatHint).toContain("26/06/2026");
    expect(m.vehicleRegPrivatePending).toContain("{count}");
  });

  it("the English OCR caution says plainly that automatic reading can be wrong and must be checked; the type copy says it is never chosen automatically", () => {
    const en = messages("en");
    expect(en.vehicleOnboardOcrNotice).toMatch(/can make mistakes/);
    expect(en.vehicleOnboardOcrNotice).toMatch(/check every field/);
    expect(en.vehicleOnboardDeclaration).toMatch(/reviewed/);
    expect(en.vehicleRegTypeMustChoose).toMatch(/never selected automatically/);
    expect(en.vehicleOnboardRegisteredSeatsHint).toMatch(/never calculated from the passenger count/);
    expect(en.vehicleOnboardBookableHint).toMatch(/never more than the licensed/);
    expect(en.vehicleRegModelHint).toMatch(/not the year/);
  });

  it("the Arabic strings are present, right-to-left text, concise about the capacity difference, and use the correct brand spelling", () => {
    const ar = messages("ar");
    for (const key of KEYS) expect(ar[key], key).toMatch(/[؀-ۿ]/);
    expect(ar.vehicleOnboardLicensedHint).toContain("عدد الركاب");
    expect(ar.vehicleOnboardRegisteredSeatsHint).toContain("المقاعد");
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });
});
