import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The review form is a client island (state + server actions) and this suite has no DOM, so its
// CONTRACT is asserted structurally: document-derived values are distinguished from what the
// provider typed, uncertain or missing fields are flagged, nothing is saved before the provider
// confirms, and OCR can never tick a box on the provider's behalf. The eight-locale copy is checked
// for completeness and for honesty about what "read automatically" means.

const ROOT = process.cwd();
const strip = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
const FORM = strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
const PROGRESS = strip("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/extraction-progress.tsx");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", locale, "provider.json"), "utf8")) as Record<string, string>;

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
    expect(FORM).toMatch(/\{flagged && <span[^>]*>\{t\("vehicleOnboardNeedsReviewBadge"\)\}<\/span>\}/);
  });

  it("a notice (manual entry / failure reason / OCR caution) is shown above the fields, and flagged fields are explained", () => {
    expect(FORM).toMatch(/\{noticeKey && <Alert variant=\{noticeVariant\}>\{td\(noticeKey\)\}<\/Alert>\}/);
    expect(FORM).toMatch(/\{anyNeedsReview && <p[^>]*>\{t\("vehicleOnboardNeedsReviewHint"\)\}<\/p>\}/);
  });

  it("never shows raw extraction data: no JSON dump, no warnings list, no engine name", () => {
    expect(FORM).not.toMatch(/JSON\.stringify|<pre|rawValue|warnings|ocrEngine|documentSha256/);
  });

  it("sensitive identifiers stay masked until the provider reveals them", () => {
    expect(FORM).toMatch(/f\.sensitive && !isRevealed/);
    expect(FORM).toMatch(/maskSensitiveValue/);
  });
});

describe("review form — nothing is finalized without the provider", () => {
  it("'create vehicle' is disabled until the review declaration is ticked — and the box starts UNTICKED", () => {
    expect(FORM).toMatch(/const \[declaration, setDeclaration\] = useState\(false\);/);
    expect(FORM).toMatch(/onClick=\{finalize\} disabled=\{pending \|\| !declaration\}/);
    expect(FORM).toMatch(/declarationAccepted: declaration/);
  });

  it("the form only PREFILLS: the only writers are the explicit save / create / cancel actions", () => {
    expect((FORM.match(/await (saveOnboardingDraftAction|finalizeVehicleAction|cancelOnboardingAction)\(/g) ?? []).sort()).toEqual([
      "await cancelOnboardingAction(",
      "await finalizeVehicleAction(",
      "await saveOnboardingDraftAction(",
    ]);
    expect(FORM).not.toMatch(/useEffect\(/); // nothing is submitted automatically on load
  });

  it("the 4x4 declaration is NEVER pre-ticked from the document — it starts false and only the provider's click changes it", () => {
    expect(FORM).toMatch(/const \[claimedFourByFour, setClaimedFourByFour\] = useState\(false\);/);
    expect((FORM.match(/setClaimedFourByFour\(/g) ?? []).length).toBe(1);
    expect(FORM).toMatch(/onChange=\{\(e\) => setClaimedFourByFour\(e\.target\.checked\)\}/);
  });

  it("the vehicle TYPE may be pre-selected from a suggestion but is always the provider's choice", () => {
    expect(FORM).toMatch(/useState<string>\(suggestedVehicleType \?\? ""\)/);
    expect(FORM).toMatch(/onChange=\{\(e\) => setVehicleType\(e\.target\.value\)\}/);
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
  ];

  it.each(LOCALES)("%s has every string, none empty", (locale) => {
    const m = messages(locale);
    for (const key of KEYS) expect(m[key], `${locale}:${key}`).toEqual(expect.stringMatching(/\S/));
  });

  it.each(LOCALES)("%s: every failure message keeps the provider moving — the document is saved and they can retry or enter the details", (locale) => {
    const m = messages(locale);
    // Each OCR failure string is a full sentence (not a code) and differs from the others.
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
      expect(m[key], key).not.toMatch(/\bOCR\b|\bAI\b|\bLLM\b|JSON/); // case-sensitive: French "j'ai" is not jargon
    }
  });

  it("the English OCR caution says plainly that automatic reading can be wrong and must be checked", () => {
    const en = messages("en");
    expect(en.vehicleOnboardOcrNotice).toMatch(/can make mistakes/);
    expect(en.vehicleOnboardOcrNotice).toMatch(/check every field/);
    expect(en.vehicleOnboardDeclaration).toMatch(/reviewed/);
    expect(en.vehicleOnboardFileHintOcr).toMatch(/you always review and confirm/);
  });

  it("the Arabic strings are present, right-to-left text, and use the correct brand spelling", () => {
    const ar = messages("ar");
    for (const key of KEYS) expect(ar[key], key).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });
});
