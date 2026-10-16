import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// 2026-10-16 vehicle-journey visual checkpoint — the document-first journey (upload → reading →
// review) redesigned as ONE product: a four-step header, one card surface, one reading state, teal for
// document suggestions, amber only for "needs review", 48 px actions. This file pins the redesign's
// contract; behaviour (routes, actions, consent evidence, provenance, privacy) is pinned by the
// existing suites, which this checkpoint keeps green. Vitest runs without a DOM: the two small new
// components are rendered to markup, the screens are asserted on their source.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}/provider.json`)) as Record<string, string>]));

let locale: (typeof LOCALES)[number] = "ar";
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), messages[locale]![key] ?? `MISSING:${key}`),
}));

const { VehicleJourneySteps } = await import("./journey-steps");
const { journeyStepStates } = await import("./journey-progress");
type JourneyProgress = import("./journey-progress").JourneyProgress;
const { ReadingStatusPanel } = await import("./reading-status-panel");

const UI = read("src/components/provider/vehicle-journey/journey-ui.ts");
const STEPS = read("src/components/provider/vehicle-journey/journey-steps.tsx");
const PANEL = read("src/components/provider/vehicle-journey/reading-status-panel.tsx");
const UPLOAD_PAGE = read("src/app/[locale]/provider/vehicles/new/page.tsx");
const UPLOAD = read("src/app/[locale]/provider/vehicles/new/_components/registration-upload-form.tsx");
const PAGE = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx");
const CONSENT = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx");
const PROGRESS = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/extraction-progress.tsx");
const REVIEW = read("src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form.tsx");
const ASSIST = read("src/components/provider/registration-review/field-assist.tsx");
const stripComments = (src: string) => src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const NEW_KEYS = [
  "vehicleJourneyStepsLabel",
  "vehicleJourneyStep1",
  "vehicleJourneyStep2",
  "vehicleJourneyStep3",
  "vehicleJourneyStep4",
  "vehicleJourneyStepDone",
  "vehicleJourneyStepFailed",
  "vehicleJourneyStepNotRead",
  "vehicleJourneyUploadTitle",
  "vehicleJourneyUploadHint",
  "vehicleJourneyFileRequirements",
  "vehicleJourneyTrust1",
  "vehicleJourneyTrust2",
  "vehicleJourneyTrust3",
  "vehicleJourneyConsentNeedsAuthorization",
  "vehicleJourneyReadingFailedManual",
];

beforeEach(() => {
  locale = "ar";
});

describe("1. the shared four-step journey header", () => {
  const render = (progress: JourneyProgress) => renderToStaticMarkup(createElement(VehicleJourneySteps, { progress }));
  /** state, aria-current and announced status text of each of the four steps. */
  const parse = (html: string) =>
    [...html.matchAll(/<li /g)].map((m, n) => {
      const li = html.slice(m.index!, html.indexOf("</li>", m.index!));
      return { state: li.match(/data-step-state="([a-z]+)"/)![1], current: li.includes('aria-current="step"'), sr: li.match(/<span class="sr-only"> — ([^<]+)<\/span>/)?.[1] ?? null, step: n + 1, html: li };
    });

  it("Arabic: the approved step names, in order, inside a labelled nav with an ordered list", () => {
    const html = render({ stage: "upload" });
    expect(html).toMatch(/^<nav aria-label="خطوات إضافة المركبة" class="journey-steps text-xs"><ol /);
    const labels = ["رفع الملكية", "قراءة البيانات", "مراجعة البيانات", "إنشاء المركبة"];
    let at = 0;
    for (const label of labels) {
      const i = html.indexOf(label, at);
      expect(i, label).toBeGreaterThan(at);
      at = i;
    }
    expect(html).not.toContain("MISSING:");
  });

  it("English: Upload document / Read details / Review details / Create vehicle", () => {
    locale = "en";
    const html = render({ stage: "read" });
    for (const label of ["Upload document", "Read details", "Review details", "Create vehicle"]) expect(html).toContain(label);
    expect(html).toContain('aria-label="Steps to add a vehicle"');
  });

  // Every state, Arabic and English: [name, progress, per-step states, current step, AR announced, EN announced]
  const CASES: [string, JourneyProgress, string[], number, (string | null)[], (string | null)[]][] = [
    ["upload", { stage: "upload" }, ["current", "upcoming", "upcoming", "upcoming"], 1, [null, null, null, null], [null, null, null, null]],
    ["reading in progress", { stage: "read" }, ["completed", "current", "upcoming", "upcoming"], 2, ["مكتملة", null, null, null], ["done", null, null, null]],
    ["reading failed before review opens", { stage: "read", failed: true }, ["completed", "error", "upcoming", "upcoming"], 2, ["مكتملة", "لم تنجح القراءة", null, null], ["done", "reading unsuccessful", null, null]],
    ["reading succeeded", { stage: "review", reading: "succeeded" }, ["completed", "completed", "current", "upcoming"], 3, ["مكتملة", "مكتملة", null, null], ["done", "done", null, null]],
    ["reading failed, manual review open", { stage: "review", reading: "failed" }, ["completed", "error", "current", "upcoming"], 3, ["مكتملة", "لم تنجح القراءة", null, null], ["done", "reading unsuccessful", null, null]],
    ["not read (declined / not analysed), manual review", { stage: "review", reading: "skipped" }, ["completed", "skipped", "current", "upcoming"], 3, ["مكتملة", "لم تتم القراءة — إدخال يدوي", null, null], ["done", "not read — entered manually", null, null]],
  ];

  it.each(CASES)("%s — Arabic and English: exact states, ONE current step, honest announced status", (_name, progress, states, current, srAr, srEn) => {
    for (const [lang, sr] of [["ar", srAr], ["en", srEn]] as const) {
      locale = lang;
      const steps = parse(render(progress));
      expect(steps.map((x) => x.state), lang).toEqual(states);
      expect(steps.filter((x) => x.current).map((x) => x.step), lang).toEqual([current]);
      expect(steps.map((x) => x.sr), lang).toEqual(sr);
    }
  });

  it("1. a failed reading is NEVER completed: no check mark, never announced 'done', in either stage", () => {
    for (const progress of [{ stage: "read", failed: true }, { stage: "review", reading: "failed" }] as JourneyProgress[]) {
      expect(journeyStepStates(progress)[1]!.status).toBe("error");
      for (const lang of ["ar", "en"] as const) {
        locale = lang;
        const step2 = parse(render(progress))[1]!;
        expect(step2.sr).toBe(messages[lang]!.vehicleJourneyStepFailed);
        expect(step2.html).not.toContain(messages[lang]!.vehicleJourneyStepDone);
        expect(step2.html).not.toMatch(/lucide-check/);
        expect(step2.html).toMatch(/lucide-(triangle-alert|alert-triangle)/);
      }
    }
  });

  it("2. manual fallback after a failure makes REVIEW the current step (step 2 stays an error, never a success)", () => {
    const s = journeyStepStates({ stage: "review", reading: "failed" });
    expect(s.find((x) => x.current)!.step).toBe(3);
    expect(s[1]).toEqual({ step: 2, status: "error", current: false });
  });

  it("states are told apart by SHAPE and announced text, not colour alone; no status claims BARQ verified anything", () => {
    expect(render({ stage: "review", reading: "succeeded" })).toMatch(/lucide-check/); // completed → check
    expect(render({ stage: "review", reading: "skipped" })).toMatch(/lucide-minus/); // skipped → dash
    expect(render({ stage: "read", failed: true })).toMatch(/lucide-(triangle-alert|alert-triangle)/); // error → warning mark
    expect(render({ stage: "read" })).toMatch(/ring-4 ring-primary\/15/); // current → ring + bold label
    expect(STEPS).toMatch(/aria-hidden className=\{`absolute start-0 end-1\/2/);
    expect(STEPS).toMatch(/aria-hidden className=\{`absolute start-1\/2 end-0/);
    expect(STEPS).toMatch(/error: "border-2 border-warning bg-warning\/15 text-foreground"/); // restrained amber
    for (const l of LOCALES) {
      for (const k of ["vehicleJourneyStepDone", "vehicleJourneyStepFailed", "vehicleJourneyStepNotRead"]) {
        expect(messages[l]![k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
        expect(messages[l]![k], `${l}.${k}`).not.toMatch(/verified|verificat|تحقق|موثق|geprüft|vérifi|zweryfik|ověř|провер/i);
      }
    }
  });

  it("200 % text: when four labels cannot fit, ONE 'Step n of 4' line replaces them (labels stay announced); normal sizes unchanged", () => {
    const CSS = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(CSS).toMatch(/\.journey-steps \{\s*container: journey-steps \/ inline-size;\s*\}/);
    expect(CSS).toMatch(/\.journey-steps-compact \{\s*display: none;\s*\}/);
    expect(CSS).toMatch(/@container journey-steps \(max-width: 19em\) \{\s*\.journey-steps-label \{\s*position: absolute;[\s\S]*?clip: rect\(0, 0, 0, 0\);[\s\S]*?\.journey-steps-compact \{\s*display: block;/);
    // visually-hidden (not display:none) — the step names stay in the accessibility tree
    expect(CSS.slice(CSS.indexOf("@container journey-steps"))).not.toMatch(/\.journey-steps-label \{[^}]*display: none/);
    for (const [lang, text] of [["ar", "الخطوة 3 من 4: مراجعة البيانات — "], ["en", "Step 3 of 4: Review details"]] as const) {
      locale = lang;
      const html = render({ stage: "review", reading: "failed" });
      expect(html).toMatch(/<p aria-hidden="true" class="journey-steps-compact /);
      expect(html).toContain(lang === "ar" ? "الخطوة 3 من 4: مراجعة البيانات" : text);
      expect((html.match(/class="journey-steps-label /g) ?? []).length).toBe(4);
    }
    locale = "ar";
    expect(render({ stage: "read", failed: true })).toContain("الخطوة 2 من 4: قراءة البيانات — لم تنجح القراءة");
    for (const l of LOCALES) expect(messages[l]!.vehicleJourneyStepOf, l).toMatch(/\{step\}[\s\S]*\{name\}/);
  });

  it("a connector is teal only after a COMPLETED step — never leading out of a failed or skipped reading", () => {
    expect(STEPS).toMatch(/const prevCompleted = i > 0 && states\[i - 1\]!\.status === "completed";/);
    expect(STEPS).toMatch(/\$\{status === "completed" \? "bg-secondary" : "bg-border"\}/);
  });

  it("each screen passes the right progress: upload, read (consent / reading), review with the honest reading outcome", () => {
    expect(UPLOAD_PAGE).toMatch(/<VehicleJourneySteps progress=\{\{ stage: "upload" \}\} \/>/);
    expect(PAGE).toMatch(/pageHeader\(t\("addVehicleButton"\), null, \{ stage: "upload" \}\)/);
    expect(PAGE).toMatch(/pageHeader\(t\("addVehicleButton"\), null, \{ stage: "read" \}\)/);
    // the review subtitle mentions document suggestions, so it is shown only when there are some
    expect(PAGE).toMatch(/pageHeader\(t\("vehicleOnboardReviewTitle"\), isManual \? null : t\("vehicleOnboardReviewSubtitle"\), \{ stage: "review", reading: readingOutcome \}\)/);
    expect(PAGE).toMatch(/const readingOutcome: "succeeded" \| "failed" \| "skipped" = !isManual \? "succeeded" : reviewState\.extraction === "FAILED" \? "failed" : "skipped";/);
    // step 4 is never reached on these screens — creating the vehicle leaves for its detail page
    expect(journeyStepStates({ stage: "review", reading: "succeeded" })[3]!.status).toBe("upcoming");
  });

  it("11. an in-step failure reaches the header only through the client-only journey status (no request, no storage)", () => {
    expect(STEPS).toMatch(/const effective: JourneyProgress = progress\.stage === "read" && live\?\.readingFailed \? \{ stage: "read", failed: true \} : progress;/);
    const STATUS = read("src/components/provider/vehicle-journey/journey-status.tsx");
    const PROG = read("src/components/provider/vehicle-journey/journey-progress.ts");
    for (const src of [STATUS, PROG, STEPS]) expect(stripComments(src)).not.toMatch(/Action\(|fetch\(|sessionStorage|localStorage|useEffect|router/);
    // without a provider (every other screen) nothing changes
    expect(render({ stage: "read" })).toContain('data-step-state="current"');
  });
});

describe("2–3. upload screen", () => {
  it("the title is 'إضافة مركبة' and the zone says 'رفع ملكية المركبة' + 'PDF أو صورة واضحة للوجه الأمامي والخلفي'", () => {
    expect(messages.ar!.addVehicleButton).toBe("إضافة مركبة");
    expect(UPLOAD_PAGE).toMatch(/<h1 className="text-2xl font-semibold text-primary">\{t\("addVehicleButton"\)\}<\/h1>/);
    expect(messages.ar!.vehicleJourneyUploadTitle).toBe("رفع ملكية المركبة");
    expect(messages.ar!.vehicleJourneyUploadHint).toBe("PDF أو صورة واضحة للوجه الأمامي والخلفي");
    expect(messages.ar!.vehicleJourneyFileRequirements).toBe("متطلبات الملف");
  });

  it("the choices are real labels around the (unchanged) file inputs — camera keeps capture=environment", () => {
    expect(UPLOAD).toMatch(/<label className=\{`\$\{JOURNEY_PRIMARY\} cursor-pointer focus-within:ring-2[^`]*`\}>\s*<FileUp[^>]*\/>\s*\{t\("vehicleOnboardChooseFile"\)\}\s*<input ref=\{fileRef\} type="file" accept=\{ACCEPT_FILE\}/);
    expect(UPLOAD).toMatch(/<input ref=\{cameraRef\} type="file" accept=\{ACCEPT_CAMERA\} capture="environment"/);
  });

  it("2. the chosen set is an ORDERED list: slot 1 = the PDF or the front side, slot 2 = the optional back side (photo only)", () => {
    const list = UPLOAD.slice(UPLOAD.indexOf('<ol className="flex flex-col gap-4">'), UPLOAD.indexOf("</ol>"));
    expect(list.indexOf("SLOT 1")).toBeGreaterThan(-1);
    expect(list.indexOf("SLOT 1")).toBeLessThan(list.indexOf("SLOT 2"));
    expect(list).toMatch(/\{singleFile \? t\("vehicleOnboardFileLabel"\) : t\("vehicleOnboardFrontSlotLabel"\)\}/);
    expect(list).toMatch(/\{canAddBack && \(/);
    expect(list).toMatch(/t\("vehicleOnboardBackSlotLabel"\)/);
    // an error belongs to the slot it is about; the general alert shows only when no slot owns it
    expect(list).toMatch(/\{slotError\("front"\)\}[\s\S]*\{slotError\("back"\)\}/);
    expect(UPLOAD).toMatch(/\{errorKey && errorSlot === null && <Alert variant="danger">/);
  });

  it("previews stay compact (max 192 px) so the set and the action fit on a phone", () => {
    expect((UPLOAD.match(/className="max-h-48 w-full rounded-xl bg-card object-contain"/g) ?? []).length).toBe(2);
    expect(UPLOAD).not.toMatch(/max-h-(56|64|72|80|96)/);
  });

  it("3. the file requirements start COLLAPSED (a native <details> with no open attribute)", () => {
    expect(UPLOAD).toMatch(/<details className="group rounded-2xl border border-border bg-card">\s*<summary[^>]*>\s*<span>\{t\("vehicleJourneyFileRequirements"\)\}<\/span>/);
    expect(UPLOAD).not.toMatch(/<details[^>]*\sopen/);
  });

  it("the upload, its progress and its action bar keep their behaviour (same form post, same buttons, same cancel)", () => {
    expect(UPLOAD).toMatch(/<form action=\{action\} method="post" encType="multipart\/form-data" onSubmit=\{onSubmit\} aria-busy=\{busy\}/);
    expect(UPLOAD).toMatch(/<button type="submit" disabled=\{!front \|\| busy \|\| requestCancelled \|\| leaving\} className=\{`\$\{JOURNEY_PRIMARY\} w-full sm:w-auto sm:min-w-56`\}>/);
    expect(UPLOAD).toMatch(/<Link href=\{cancelHref\} onClick=\{onCancel\} aria-disabled=\{leaving\}/);
  });
});

describe("4–5. consent and reading", () => {
  it("4. title, three trust points and the two choices use the approved wording (AR + EN)", () => {
    expect(messages.ar!.vehicleRegConsentTitle).toBe("قراءة بيانات المركبة");
    expect(messages.ar!.vehicleJourneyTrust1).toBe("البيانات تظهر لك للمراجعة");
    expect(messages.ar!.vehicleJourneyTrust2).toBe("لا يتم إنشاء المركبة تلقائيًا");
    expect(messages.ar!.vehicleJourneyTrust3).toBe("يمكنك إدخال البيانات يدويًا");
    expect(messages.ar!.vehicleRegConsentReadButton).toBe("قراءة بيانات المركبة");
    expect(messages.ar!.vehicleRegConsentManualButton).toBe("إدخال البيانات يدويًا");
    expect(messages.en!.vehicleRegConsentReadButton).toBe("Read vehicle details");
    expect(messages.en!.vehicleRegConsentManualButton).toBe("Enter details manually");
    expect(CONSENT).toMatch(/const TRUST_KEYS = \["vehicleJourneyTrust1", "vehicleJourneyTrust2", "vehicleJourneyTrust3"\] as const;/);
  });

  it("4. one strong primary (read) and a quieter manual choice; the authorization box starts UNTICKED and gates only 'read'", () => {
    expect(CONSENT).toMatch(/const \[ownerAuthorized, setOwnerAuthorized\] = useState\(false\);/);
    expect(CONSENT).toMatch(/className=\{`\$\{JOURNEY_PRIMARY\} \$\{CONSENT_PRIMARY_WIDTH\}`\}/);
    expect(CONSENT).toMatch(/className=\{`\$\{JOURNEY_TERTIARY\} \$\{CONSENT_SECONDARY_WIDTH\}`\}/);
    // manual entry never requires the attestation (no consent is given by choosing it)
    expect(CONSENT).toMatch(/if \(which === "read" && !ownerAuthorized\) return;/);
    expect(CONSENT).not.toMatch(/which === "manual" && !ownerAuthorized/);
    expect(CONSENT).toMatch(/onClick=\{\(\) => run\("manual"\)\} disabled=\{pending \|\| busy !== null\}/);
  });

  it("the privacy details stay collapsed in the ordinary flow (open only when the notice changed)", () => {
    expect(CONSENT).toMatch(/<details className="group rounded-2xl border border-border" open=\{mode === "stale"\}>/);
  });

  it("5. a tap replaces the choice with the reading panel in the same event — guarded, no button inside", () => {
    expect(CONSENT).toMatch(/if \(inFlight\.current\) return;/);
    expect(CONSENT).toMatch(/\{reading \? \(\s*(\/\/[^\n]*\n\s*)?<ReadingStatusPanel/);
    const html = renderToStaticMarkup(createElement(ReadingStatusPanel, { summary: "صورة واحدة" }));
    expect(html).toMatch(/^<div role="status" aria-live="polite" data-reading-panel=""/);
    expect(html).toContain("جارٍ قراءة بيانات المركبة…");
    expect(html).toContain("قد تستغرق القراءة بضع ثوانٍ. لا تغلق الصفحة.");
    expect(html).toContain("صورة واحدة");
    expect(html).not.toMatch(/<button|<a |<input|%/);
  });

  it("5. the panel without a summary renders no empty pill; the processing page reuses the SAME panel", () => {
    expect(renderToStaticMarkup(createElement(ReadingStatusPanel, {}))).not.toMatch(/rounded-full/);
    expect(PROGRESS).toMatch(/<ReadingStatusPanel summary=\{summary\} \/>/);
    expect(PAGE).toMatch(/<ExtractionProgress summary=\{setSummary\} \/>/);
  });

  it("a FAILED reading that may be retried gets ONE concise panel: the reason, retry, and the manual path below", () => {
    expect(PAGE).toMatch(/const readingFailed = reviewState\.extraction === "FAILED" && reviewState\.canAnalyze;/);
    expect(PAGE).toMatch(/<AnalyzeRegistrationButton vehicleId=\{vehicleId\} retry \/>/);
    expect(PAGE).toMatch(/t\("vehicleJourneyReadingFailedManual"\)/);
  });
});

describe("6–8. review screen", () => {
  it("6. the four provenance statuses read exactly as approved (AR) and keep their meaning (EN)", () => {
    expect(messages.ar!.vehicleRegStatusSuggested).toBe("اقتراح من المستند — يحتاج مراجعتك");
    expect(messages.ar!.vehicleRegStatusApplied).toBe("اخترت اقتراح المستند");
    expect(messages.ar!.vehicleRegSourceProvider).toBe("أدخلته أنت");
    expect(messages.ar!.vehicleRegStatusNotEntered).toBe("لم يتم إدخاله");
    expect(messages.en!.vehicleRegStatusSuggested).toBe("Document suggestion — review required");
    expect(messages.en!.vehicleRegStatusApplied).toBe("Document suggestion selected");
    expect(messages.en!.vehicleRegStatusNotEntered).toBe("Not entered");
    // 2026-10-16 correction: the "read automatically" / "from the document" labels are gone in every language
    for (const l of LOCALES) {
      expect(messages[l]!.vehicleRegSourceOcr, l).toBeUndefined();
      expect(messages[l]!.vehicleRegSourceDocument, l).toBeUndefined();
    }
    expect(messages.en!.vehicleRegSourceProvider).toBe("Entered by you");
    expect(messages.ar!.vehicleRegUseSuggestion).toBe("استخدام الاقتراح");
    expect(messages.ar!.vehicleOnboardReviewTitle).toBe("راجع بيانات المركبة");
  });

  it("6. the status still comes from the shared derivation (no new provenance logic in the redesign)", () => {
    expect(REVIEW).toMatch(/const status = fieldState\.status\(f\);/);
    expect(ASSIST).toMatch(/<span data-field-status=\{status\}>\{td\(statusLabelKey\(status, f\.source\)\)\}<\/span>/);
  });

  it("7. 'use suggestion' targets ONLY its own field: a local apply for that field, then focus that field's input", () => {
    expect(REVIEW).toMatch(/onApply=\{\(\) => applyFieldSuggestion\(f\)\} inputId=\{`of-\$\{f\.key\}`\}/);
    expect(ASSIST).toMatch(/onApply\(\);\s*requestAnimationFrame\(\(\) => document\.getElementById\(inputId\)\?\.focus\(\)\);/);
    // the accessible name carries the field and the value, the visible label stays short
    expect(ASSIST).toMatch(/aria-label=\{td\("vehicleRegUseSuggestionAria", \{ field: label, value: suggestion! \}\)\}/);
  });

  it("7. one field pattern: label → input → status / suggestion → hint → comparison → error (linked with aria-describedby)", () => {
    const field = REVIEW.slice(REVIEW.indexOf("const renderField"), REVIEW.indexOf("const suggestedOption"));
    const order = ['<label htmlFor={`of-${f.key}`}', "<input", "<FieldStatusAndSuggestion", "{hintKey &&", "<FieldConflictAndComparison", "<p id={errorId}"];
    for (let i = 1; i < order.length; i++) expect(field.indexOf(order[i]!), order[i]).toBeGreaterThan(field.indexOf(order[i - 1]!));
    expect(field).toMatch(/aria-describedby=\{err \? errorId : undefined\}/);
  });

  it("8. the private section 'تفاصيل الملكية الخاصة' starts COLLAPSED, stays mounted, and its values are masked until revealed", () => {
    expect(messages.ar!.vehicleRegGroupPrivate).toBe("تفاصيل الملكية الخاصة");
    expect(REVIEW).toMatch(/const \[privateOpen, setPrivateOpen\] = useState\(false\);/);
    expect(REVIEW).toMatch(/aria-expanded=\{privateOpen\} aria-controls="of-private-section"/);
    expect(REVIEW).toMatch(/<div id="of-private-section" hidden=\{!privateOpen\}[^>]*>\s*\{privateFields\.map\(renderField\)\}/);
    expect(REVIEW).toMatch(/\{f\.sensitive && !isRevealed \? \(/);
    expect(REVIEW).toMatch(/\{maskSensitiveValue\(values\[f\.key\] \?\? ""\) \|\| "—"\}/);
    expect(REVIEW).toMatch(/const \[revealed, setRevealed\] = useState<Record<string, boolean>>\(\{\}\);/);
  });
});

describe("9. action bars", () => {
  it("review: Create (primary, full row) → Save progress (secondary) → Cancel (tertiary), all ≥ 48 px, sticky as before", () => {
    const bar = REVIEW.slice(REVIEW.indexOf("<StickyActionBar"), REVIEW.indexOf("</StickyActionBar>"));
    expect(bar).toMatch(/<button type="button" onClick=\{finalize\} disabled=\{!canSubmit\} className=\{`\$\{JOURNEY_PRIMARY\} col-span-2 sm:min-w-56`\}>/);
    expect(bar.indexOf("finalize")).toBeLessThan(bar.indexOf("saveDraft()"));
    expect(bar.indexOf("saveDraft()")).toBeLessThan(bar.indexOf("setConfirmingCancel(true)"));
    expect(bar).toMatch(/onClick=\{\(\) => saveDraft\(\)\} disabled=\{pending\} className=\{JOURNEY_SECONDARY\}/);
    expect(bar).toMatch(/onClick=\{\(\) => setConfirmingCancel\(true\)\} disabled=\{pending\} className=\{JOURNEY_TERTIARY\}/);
    expect(messages.ar!.vehicleOnboardCreateButton).toBe("إنشاء المركبة");
    expect(messages.ar!.vehicleOnboardSaveProgressButton).toBe("حفظ التقدّم");
    expect(messages.ar!.vehicleCancelLabel).toBe("إلغاء");
  });

  it("both bars stay the shared StickyActionBar (the page-scoped sticky fix) and respect the safe area", () => {
    for (const src of [UPLOAD, REVIEW]) {
      expect(src).toMatch(/import \{ StickyActionBar \} from "@\/components\/provider\/registration-review\/sticky-action-bar";/);
      expect(src).toMatch(/<StickyActionBar className="[^"]*pb-\[max\(env\(safe-area-inset-bottom\),0\.75rem\)\]/);
    }
    // the journey column leaves room under the last card for the bar
    expect(UI).toMatch(/export const JOURNEY_PAGE = "[^"]*pb-40/);
  });
});

describe("10–11. no behaviour hidden in the visuals", () => {
  it("10. the new journey primitives start no request: no server action, no fetch, no storage, no effect", () => {
    for (const [name, src] of [["ui", UI], ["steps", STEPS], ["panel", PANEL]] as const) {
      const code = stripComments(src);
      expect(code, name).not.toMatch(/Action\(|fetch\(|sessionStorage|localStorage|useEffect|router\./);
    }
  });

  it("10. the visual toggles only change local state (privacy details, file requirements, private section, reveal)", () => {
    expect(REVIEW).toMatch(/onClick=\{\(\) => setPrivateOpen\(\(o\) => !o\)\}/);
    expect(REVIEW).toMatch(/onClick=\{\(\) => setRevealed\(\(r\) => \(\{ \.\.\.r, \[f\.key\]: true \}\)\)\}/);
    // the server actions are called from exactly the same places as before
    expect((REVIEW.match(/saveOnboardingDraftAction\(/g) ?? []).length).toBe(1);
    expect((REVIEW.match(/finalizeVehicleAction\(/g) ?? []).length).toBe(1);
    expect((REVIEW.match(/cancelOnboardingAction\(/g) ?? []).length).toBe(1);
    expect((CONSENT.match(/grantOcrConsentAction\(/g) ?? []).length).toBe(1);
    expect((CONSENT.match(/declineOcrConsentAction\(/g) ?? []).length).toBe(1);
  });

  it("11. the new files import nothing server-side and reach no private data (no DB, env, storage, reader, DTO)", () => {
    const STATUS = read("src/components/provider/vehicle-journey/journey-status.tsx");
    const PROG = read("src/components/provider/vehicle-journey/journey-progress.ts");
    for (const src of [UI, STEPS, PANEL, STATUS, PROG]) {
      expect(stripComments(src)).not.toMatch(/@\/lib\/db|@prisma|process\.env|storage|reader|server-only|@\/lib\/vehicles/);
    }
    expect(STATUS).toMatch(/^"use client";/);
    expect(STEPS).toMatch(/^"use client";/);
    expect(PANEL).toMatch(/^"use client";/);
  });
});

describe("12–15. colour, direction, motion, announcements", () => {
  it("12. teal (secondary) marks suggestions and progress; amber (warning) is used ONLY for 'needs review' chips", () => {
    expect(UI).toMatch(/JOURNEY_CHIP_SUGGESTION = "[^"]*bg-secondary\/10[^"]*text-secondary-700/);
    expect(UI).toMatch(/JOURNEY_CHIP_REVIEW = "[^"]*bg-warning\/15/);
    expect(ASSIST).toMatch(/\{flagged && <span className=\{`\$\{CHIP\} bg-warning\/15 text-foreground`\}>\{t\("vehicleOnboardNeedsReviewBadge"\)\}/);
    expect(ASSIST).toMatch(/rounded-xl border border-secondary\/30 bg-secondary\/5 px-3 py-2/);
    // a conflict the provider must resolve is amber too — the old orange-beige accent tint is gone from the review
    expect(ASSIST).toMatch(/rounded-xl border border-warning\/40 bg-warning\/10 p-3/);
    expect(ASSIST).not.toMatch(/(bg|border|text)-accent/);
    expect(UPLOAD).toMatch(/<div className="h-full rounded-full bg-secondary transition-\[width\]"/);
    for (const src of [UI, STEPS, PANEL, UPLOAD, CONSENT, PROGRESS, REVIEW]) expect(src).not.toMatch(/bg-warning\/(?!15)|text-warning\b/);
    // the private chip is amber only while something is genuinely missing
    expect(REVIEW).toMatch(/className=\{pendingPrivate > 0 \? JOURNEY_CHIP_REVIEW : JOURNEY_CHIP_SUGGESTION\}/);
  });

  it("12. one navy primary style for the journey's main actions", () => {
    expect(UI).toMatch(/export const JOURNEY_PRIMARY = `[^`]*bg-primary[^`]*text-primary-foreground/);
    expect(UI).toMatch(/disabled:bg-foreground\/15 disabled:text-foreground\/60/); // visibly disabled, not merely faded
  });

  it("13. RTL / LTR mirror by themselves: logical spacing only, and the back arrow flips in English", () => {
    for (const [name, src] of [["ui", UI], ["steps", STEPS], ["panel", PANEL], ["upload", UPLOAD], ["upload page", UPLOAD_PAGE], ["page", PAGE], ["consent", CONSENT], ["progress", PROGRESS], ["review", REVIEW]] as const) {
      expect(src, name).not.toMatch(/\b(ml|mr|pl|pr|left|right)-(\d|\[|auto|px|1\/2)/);
      expect(src, name).not.toMatch(/text-(left|right)\b/);
    }
    expect(UPLOAD_PAGE).toMatch(/ltr:rotate-180/);
    expect(PAGE).toMatch(/ltr:rotate-180/);
  });

  it("13. nothing forces a phone to scroll sideways: the steps share 4 equal shrinkable columns; the column has 16 px gutters", () => {
    expect(STEPS).toMatch(/<ol className="grid grid-cols-4">/);
    expect(STEPS).toMatch(/className="flex min-w-0 flex-col items-center gap-1\.5 text-center"/);
    expect(UI).toMatch(/JOURNEY_PAGE = "mx-auto flex w-full max-w-\[52rem\] flex-col gap-6 px-4 /);
    for (const src of [UI, STEPS, PANEL, UPLOAD, CONSENT, REVIEW]) expect(src).not.toMatch(/\bw-\[(?!100%)[0-9]{3,}px\]|min-w-\[[0-9]{3,}px\]|whitespace-nowrap/);
  });

  it("14. motion is decorative and stops under prefers-reduced-motion", () => {
    for (const src of [STEPS, PANEL, UPLOAD, CONSENT, PROGRESS, REVIEW]) expect(stripComments(src)).not.toMatch(/(?<![a-z-]:)animate-(spin|ping|pulse|bounce)/);
    expect(PANEL).toMatch(/motion-safe:animate-ping/);
  });

  it("15. state changes are announced politely; focus stays visible on every journey action", () => {
    expect(PANEL).toMatch(/role="status" aria-live="polite"/);
    expect(UPLOAD).toMatch(/<p className="sr-only" aria-live="polite">/);
    expect(UPLOAD).toMatch(/<div className="flex flex-col gap-1\.5" role="status" aria-live="polite">/);
    for (const name of ["JOURNEY_PRIMARY", "JOURNEY_SECONDARY", "JOURNEY_TERTIARY", "JOURNEY_SMALL"]) {
      const def = UI.slice(UI.indexOf(`export const ${name} =`));
      expect(def.slice(0, def.indexOf("\n")), name).toContain("${FOCUS}");
    }
    expect(UI).toMatch(/const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary\/50";/);
  });
});

describe("16. copy in every language", () => {
  it.each(LOCALES)("%s has every new journey key, non-empty, with no stray placeholder", (l) => {
    const m = messages[l]!;
    for (const k of NEW_KEYS) {
      expect(m[k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
      expect(m[k], `${l}.${k}`).not.toMatch(/[{}]/);
    }
  });

  it("all eight provider files keep the same key set", () => {
    const ref = Object.keys(messages.en!).sort();
    for (const l of LOCALES) expect(Object.keys(messages[l]!).sort(), l).toEqual(ref);
  });

  it("the Arabic brand is never misspelled in the new copy", () => {
    for (const k of NEW_KEYS) expect(messages.ar![k], k).not.toContain("بارق");
  });
});
