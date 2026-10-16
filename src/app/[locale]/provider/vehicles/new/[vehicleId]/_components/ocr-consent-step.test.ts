import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The standalone processing notice + choice step. Structural checks on the component (Vitest here
// runs without a DOM) and content checks on the copy in every supported language.
//
// 2026-10-16 presentation: the ordinary workflow carries ONE sentence (a copy of the document is used
// to extract and SUGGEST the vehicle details; nothing is accepted before the provider reviews and
// saves), a visible Privacy Policy link, the attestation and the two choices. "Privacy details" holds a
// short neutral sentence about an external technical processing provider + the limits + what is
// recorded. The FULL disclosure (processor identity, what is sent, geography, purpose, accuracy,
// declining, retention) moved verbatim into the Privacy Policy's #automatic-reading section.
// Tap feedback: in-flight guard, spinner + "Reading vehicle details…", live region, no percentage.

const ROOT = process.cwd();
const CODE = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx"), "utf8");
const stripComments = (src: string) => src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const PROGRESS = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/extraction-progress.tsx"), "utf8");
// 2026-10-16 visual checkpoint: the reading state is ONE shared panel used by the step and the processing page.
const PANEL = readFileSync(path.join(ROOT, "src/components/provider/vehicle-journey/reading-status-panel.tsx"), "utf8");
const PRIVACY_PAGE = readFileSync(path.join(ROOT, "src/app/[locale]/privacy/page.tsx"), "utf8");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/provider.json`), "utf8")) as Record<string, string>]));
const policy = Object.fromEntries(
  LOCALES.map((l) => [l, (JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/pages.json`), "utf8")) as { privacy: { automaticReading: Record<string, string> } }).privacy.automaticReading]),
);

/** Copy the provider sees in the ORDINARY workflow (without opening "Privacy details"). */
const ORDINARY_KEYS = [
  "vehicleRegConsentTitle",
  "vehicleRegConsentIntro",
  "vehicleRegConsentIntroPdf",
  "vehicleRegConsentDisclosure",
  "vehicleRegConsentPrivacyPolicyLink",
  "vehicleRegConsentDetailsToggle",
  "vehicleRegConsentOwnerLabel",
  "vehicleRegConsentReadButton",
  "vehicleRegConsentManualButton",
  "vehicleRegConsentPending",
  "vehicleRegConsentReadingPending",
  "vehicleRegConsentReadingHint",
  "vehicleRegConsentDeclinedNotice",
  "vehicleRegConsentChangeMind",
  "vehicleRegConsentStaleNotice",
];
/** Copy behind "Privacy details" — short and neutral. */
const DETAIL_KEYS = ["vehicleRegConsentDetailsExternal", "vehicleRegConsentLimits", "vehicleRegConsentLegalNote"];
const NOTICE_KEYS = [...ORDINARY_KEYS, ...DETAIL_KEYS];
const RESULT_KEYS = ["vehicleRegOcrNotAvailable", "vehicleRegConsentOwnerRequired", "vehicleRegStateAwaitingChoice", "vehicleRegExtractFailOcrRateLimited", "vehicleRegExtractFailOcrAttemptLimit"];
/** The Privacy Policy's automatic-reading section (the full disclosure). */
const POLICY_KEYS = ["title", "processor", "processorPdf", "processorImages", "geoGlobal", "purpose", "accuracy", "decline", "retention", "limits", "recorded"];

// Vendor / technology / geography wording that must NOT appear ANYWHERE in the provider workflow now
// (ordinary copy AND privacy details). Abbreviations are matched case-sensitively ("ai" is Italian).
const TECH_ABBREVIATIONS = /\bAI\b|\bKI\b|\bIA\b|\bИИ\b/;
const VENDOR_OR_AI_WORDS = /anthropic|claude|\bsonnet\b|\bopus\b|الذكاء الاصطناعي|ذكاء اصطناعي|artificial intelligence|intelligence artificielle|künstliche intelligenz|intelligenza artificiale|sztuczn|umělá inteligence|искусственн/i;
const COUNTRY_OR_SERVER = /american servers|US servers|خوادم أمريكية|الخوادم الأمريكية|الولايات المتحدة|أمريك|خارج سلطنة|خارج عُمان|outside Oman|united states|vereinigten staaten|stati uniti|états-unis|stanach zjednoczonych|spojených státech|сша|außerhalb (von )?Oman|fuori dall'Oman|poza Omanem|hors d'Oman|mimo Omán|за пределами Омана/i;
const expectNeutral = (value: string, label: string) => {
  expect(value, label).not.toMatch(TECH_ABBREVIATIONS);
  expect(value, label).not.toMatch(VENDOR_OR_AI_WORDS);
  expect(value, label).not.toMatch(COUNTRY_OR_SERVER);
};

describe("OcrConsentStep — structure", () => {
  it("is a client island that renders every notice key and offers exactly the two choices", () => {
    expect(CODE).toMatch(/^"use client";/);
    for (const key of NOTICE_KEYS) expect(CODE + PANEL, key).toContain(`"${key}"`);
    expect(CODE).toContain("grantOcrConsentAction(vehicleId, ownerAuthorized)");
    expect(CODE).toContain("declineOcrConsentAction(vehicleId)");
  });

  it("11. the 'read' button stays disabled until the owner/authorized box is ticked; the box starts UNTICKED", () => {
    expect(CODE).toMatch(/const \[ownerAuthorized, setOwnerAuthorized\] = useState\(false\);/);
    expect(CODE).toMatch(/const readDisabled = pending \|\| busy !== null \|\| !ownerAuthorized;/);
    expect(CODE).toMatch(/onClick=\{\(\) => run\("read"\)\} disabled=\{readDisabled\} aria-disabled=\{readDisabled\}/);
    // the reason the button is unavailable is said next to it (not only by a greyed button)
    expect(CODE).toMatch(/aria-describedby=\{!ownerAuthorized \? "consent-needs-authorization" : undefined\}/);
    expect(CODE).toMatch(/\{!ownerAuthorized && \(\s*<p id="consent-needs-authorization"/);
    expect(CODE).toMatch(/if \(which === "read" && !ownerAuthorized\) return;/);
    expect(CODE).toMatch(/type="checkbox" checked=\{ownerAuthorized\}/);
  });

  it("surfaces only localized result messages — never a raw code, engine name, model id or vendor endpoint", () => {
    expect(CODE).toContain("registrationReviewMessageKey(errorCode)");
    expect(CODE).not.toMatch(/OCR_[A-Z_]+|claude-|sonnet|api\.anthropic\.com|JSON\.stringify\(res/);
  });

  it("imports nothing server-side (no prisma, no env, no reader, no service)", () => {
    expect(CODE).not.toMatch(/@\/lib\/db|process\.env|get-registration-document-reader|claude-vision-reader|extract-registration-service|ocr-consent"/);
  });

  it("the consent is never implied: no auto-grant on mount, on upload, on reload or on retry — only the explicit 'read' click grants", () => {
    expect(CODE).not.toMatch(/useEffect/);
    expect((CODE.match(/grantOcrConsentAction\(/g) ?? []).length).toBe(1);
    expect((CODE.match(/grantOcrConsentForCompletionAction\(/g) ?? []).length).toBe(1);
    expect(CODE).toMatch(/which === "read"\s*\?\s*intent === "complete"\s*\?\s*await grantOcrConsentForCompletionAction\(vehicleId, ownerAuthorized\)\s*:\s*await grantOcrConsentAction\(vehicleId, ownerAuthorized\)\s*:\s*await declineOcrConsentAction\(vehicleId\)/);
  });

  it("the 'complete' intent reuses the SAME notice, attestation and buttons; only the intro differs and the grant starts the completion", () => {
    expect(CODE).toContain('intent === "complete" ? t("vehicleRegConsentIntroComplete")');
    expect(CODE).toMatch(/intent = "read"/);
    expect(CODE).toMatch(/if \(which === "manual" && intent === "complete"\) \{\s*settle\(null\);\s*onDeclined\?\.\(\);\s*\}/);
    expect(CODE).toMatch(/res\.completion && !res\.completion\.ok/);
  });
});

describe("Correction A — immediate reading feedback, one request per tap", () => {
  it("1/2. the tap enters the pending state in the SAME event: guard set, busy set, button disabled, spinner + 'Reading vehicle details…'", () => {
    const run = CODE.slice(CODE.indexOf("const run = (which"), CODE.indexOf("startTransition(async"));
    expect(run).toMatch(/if \(inFlight\.current\) return;/);
    expect(run.indexOf("inFlight.current = true;")).toBeLessThan(run.indexOf("setBusy(which);"));
    expect(CODE).toMatch(/const inFlight = useRef\(false\);/);
    // the accepted tap replaces the choice with the calm reading panel — no button remains to tap twice
    expect(CODE).toMatch(/const reading = busy === "read";/);
    expect(CODE).toMatch(/\{reading \? \(\s*(\/\/[^\n]*\n\s*)?<ReadingStatusPanel summary=\{t\(SET_SUMMARY_KEY\[setKind\]\)\} \/>/);
    expect(PANEL).toMatch(/t\("vehicleRegConsentReadingPending"\)/);
    expect(stripComments(PANEL)).not.toMatch(/<button|onClick|Action\(|fetch\(/);
    // the pulse stands still for reduced motion
    expect(PANEL).toMatch(/motion-safe:animate-ping/);
    expect(PANEL).not.toMatch(/(?<!motion-safe:)animate-(spin|ping|pulse)/);
  });

  it("3. repeated taps create no duplicate request: the guard rejects every tap while one is in flight; both buttons lock", () => {
    expect(CODE).toMatch(/onClick=\{\(\) => run\("manual"\)\} disabled=\{pending \|\| busy !== null\} className=\{`\$\{JOURNEY_TERTIARY\} \$\{CONSENT_SECONDARY_WIDTH\}`\}/);
    expect((CODE.match(/inFlight\.current = true;/g) ?? []).length).toBe(1);
    // the guard is released ONLY when the request ended without the page being replaced
    expect(CODE).toMatch(/const settle = \(code: RegistrationReviewCode \| null\) => \{\s*inFlight\.current = false;\s*setBusy\(null\);/);
  });

  it("4. a rerender during processing creates no request: nothing starts a request outside the explicit tap (no effect, no render-time call)", () => {
    expect(CODE).not.toMatch(/useEffect|useLayoutEffect/);
    expect((CODE.match(/run\("read"\)/g) ?? []).length).toBe(1);
    expect(CODE).toMatch(/onClick=\{\(\) => run\("read"\)\}/);
  });

  it("the state is announced (aria-live) and explained, the checkbox stays ticked and locked, the step reports aria-busy", () => {
    expect(PANEL).toMatch(/<div role="status" aria-live="polite"/);
    expect(PANEL).toMatch(/t\("vehicleRegConsentReadingHint"\)/);
    // the label points at the heading only while the heading is rendered
    expect(CODE).toMatch(/aria-labelledby=\{reading \? undefined : "consent-title"\}/);
    expect(CODE).toMatch(/type="checkbox" checked=\{ownerAuthorized\} onChange=\{\(e\) => setOwnerAuthorized\(e\.target\.checked\)\} disabled=\{pending \|\| busy !== null\}/);
    expect(CODE).toMatch(/aria-busy=\{pending \|\| busy !== null\}/);
    expect(stripComments(CODE)).not.toMatch(/%|percent|progress=/i);
    expect(stripComments(PANEL)).not.toMatch(/%|percent|progress=/i);
  });

  it("6. success keeps the pending state until the refreshed page replaces the step (no flash back to an idle button)", () => {
    const after = CODE.slice(CODE.indexOf("if (res.completion && !res.completion.ok)"));
    expect(after).toMatch(/router\.refresh\(\);\s*\}\);\s*\};/);
    expect(CODE).not.toMatch(/const res =[\s\S]{0,400}setBusy\(null\);\s*if \(!res\.ok\)/); // the old unconditional reset is gone
  });

  it("7. failure / timeout / dropped request leaves the pending state with the honest error; both choices are usable again", () => {
    expect(CODE).toMatch(/\} catch \{\s*\/\/[^\n]*\n\s*settle\("UNKNOWN_ERROR"\);\s*return;\s*\}/);
    expect(CODE).toMatch(/if \(!res\.ok\) \{\s*settle\(res\.code\);\s*return;\s*\}/);
    // consent recorded but no result (error / failure / still awaiting): pending ends, the page refreshes
    expect(CODE).toMatch(/if \(analysis && !analysis\.ok\) \{\s*settle\(analysis\.code\);\s*router\.refresh\(\);\s*return;\s*\}/);
    expect(CODE).toMatch(/if \(analysis && \(analysis\.status === "FAILED" \|\| analysis\.status === "AWAITING_CONSENT"\)\) \{\s*settle\(null\);\s*router\.refresh\(\);\s*return;\s*\}/);
    expect(CODE).toMatch(/\{errorCode && <Alert variant="danger">\{td\(registrationReviewMessageKey\(errorCode\)\)\}<\/Alert>\}/);
  });

  it("the processing page shows the same spinner + copy, polls a bounded number of times and never stays 'reading' forever", () => {
    expect(PROGRESS).toMatch(/const MAX_REFRESHES = 40;/);
    expect(PROGRESS).toMatch(/if \(count >= MAX_REFRESHES\) \{\s*clearInterval\(timer\);\s*setGaveUp\(true\);\s*\}/);
    expect(PROGRESS).toMatch(/<ReadingStatusPanel summary=\{summary\} \/>/); // the same panel as the step
    expect(PANEL).toMatch(/t\("vehicleRegConsentReadingPending"\)/);
    expect(PANEL).toMatch(/t\("vehicleRegConsentReadingHint"\)/);
    expect(PROGRESS).toMatch(/t\("vehicleOnboardReadingSlow"\)/);
    expect(PROGRESS).toMatch(/onClick=\{\(\) => router\.refresh\(\)\}/);
    expect(stripComments(PROGRESS)).not.toMatch(/Action\(|fetch\(|%|percent/);
  });

  it("Arabic and English pending copy is exactly the approved wording", () => {
    expect(messages.ar!.vehicleRegConsentReadingPending).toBe("جارٍ قراءة بيانات المركبة…");
    expect(messages.en!.vehicleRegConsentReadingPending).toBe("Reading vehicle details…");
    expect(messages.ar!.vehicleRegConsentReadingHint).toBe("قد تستغرق القراءة بضع ثوانٍ. لا تغلق الصفحة.");
    expect(messages.en!.vehicleRegConsentReadingHint).toBe("Reading may take a few seconds. Keep this page open.");
  });
});

describe("Correction B — simpler consent presentation", () => {
  it("the ordinary sentence + the Privacy Policy link are OUTSIDE <details>; only the neutral sentence, limits and record note are inside", () => {
    const details = CODE.indexOf("<details");
    const detailsEnd = CODE.indexOf("</details>");
    expect(details).toBeGreaterThan(0);
    for (const key of ["vehicleRegConsentDisclosure", "vehicleRegConsentPrivacyPolicyLink", "vehicleRegConsentOwnerLabel", "vehicleRegConsentReadButton", "vehicleRegConsentManualButton", "vehicleRegConsentTitle"]) {
      const at = CODE.indexOf(`t("${key}")`);
      expect(at < details || at > detailsEnd, `${key} must be outside <details>`).toBe(true);
    }
    for (const key of DETAIL_KEYS) {
      const at = CODE.indexOf(`t("${key}")`);
      expect(at > details && at < detailsEnd, `${key} must be inside <details>`).toBe(true);
    }
    expect(CODE).toMatch(/<details[^>]*open=\{mode === "stale"\}/); // collapsed by default; opened when the notice changed
  });

  it("10. the Privacy Policy link stays visible and points at the full automatic-reading section", () => {
    expect(CODE).toMatch(/export const AUTOMATIC_READING_POLICY_HREF = "\/privacy#automatic-reading";/);
    expect(CODE).toMatch(/<Link href=\{AUTOMATIC_READING_POLICY_HREF\}/);
    expect(PRIVACY_PAGE).toMatch(/<section id="automatic-reading"/);
  });

  it("the step no longer renders processor, set or geography sentences (they live in the policy)", () => {
    expect(CODE).not.toMatch(/PROCESSOR_POINT_KEY|vehicleRegConsentPoint|inferenceGeo ===/);
  });

  it.each(LOCALES)("%s has every notice and result key, non-empty", (locale) => {
    for (const key of [...NOTICE_KEYS, ...RESULT_KEYS]) {
      expect(typeof messages[locale]![key], `${locale}.${key}`).toBe("string");
      expect(messages[locale]![key]!.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)("8. %s: no vendor, model, 'AI', country or server location anywhere in the provider workflow (ordinary copy AND privacy details)", (locale) => {
    for (const [key, value] of Object.entries(messages[locale]!)) {
      if (!/^(vehicleReg|vehicleOnboard|vehicleDoc)/.test(key)) continue;
      expectNeutral(value, `${locale}.${key}`);
    }
  });

  it("9. the details stay honest: an external technical processing provider may be used, under the Privacy Policy; declining and manual entry remain open", () => {
    expect(messages.ar!.vehicleRegConsentDetailsExternal).toBe("قد نستخدم مزود معالجة تقنيًا خارجيًا لتنفيذ القراءة التلقائية وفق سياسة الخصوصية. يمكنك رفض القراءة التلقائية وإدخال البيانات يدويًا في أي وقت.");
    expect(messages.en!.vehicleRegConsentDetailsExternal).toBe("An external technical processing provider may be used to perform automatic reading under the Privacy Policy. You may decline automatic reading and enter the details manually at any time.");
    for (const l of LOCALES) expect(messages[l]!.vehicleRegConsentDetailsExternal!.length, l).toBeGreaterThan(40);
  });

  it("the ordinary disclosure is exactly the approved Arabic / English wording", () => {
    expect(messages.ar!.vehicleRegConsentDisclosure).toBe("سنستخدم نسخة المستند لاستخراج بيانات المركبة واقتراحها لك للمراجعة. لن يتم اعتماد أي بيانات قبل مراجعتك وحفظها.");
    expect(messages.en!.vehicleRegConsentDisclosure).toBe("A copy of the document will be used to extract vehicle details and suggest them for your review. No information is accepted until you review and save it.");
  });

  it.each(LOCALES)("%s: nothing claims local / Oman-only processing, ownership verification, approval or guaranteed accuracy", (locale) => {
    const all = [...NOTICE_KEYS.map((k) => messages[locale]![k]!), ...POLICY_KEYS.map((k) => policy[locale]![k]!)].join("\n");
    expect(all).not.toMatch(/only (in|within) Oman|exclusively in Oman|processed locally|nur in Oman|solo in Oman|uniquement (en|à) Oman|tylko w Omanie|pouze v Ománu|только в Омане|فقط داخل (سلطنة )?عُ?مان|داخل (سلطنة )?عُ?مان فقط|محليًا فقط/i);
    expect(messages[locale]!.vehicleRegConsentDisclosure).not.toMatch(/verif(y|ies) ownership|approv(e|es) the vehicle|guarantee|accurate/i);
  });

  it("12. manual entry needs no consent and no attestation", () => {
    expect(CODE).toMatch(/onClick=\{\(\) => run\("manual"\)\} disabled=\{pending \|\| busy !== null\}/);
    expect(CODE).not.toMatch(/run\("manual"\)[^\n]*ownerAuthorized/);
  });

  it("the declined notice promises only what the server guarantees: the document is not SENT for automatic reading", () => {
    expect(messages.en!.vehicleRegConsentDeclinedNotice).toMatch(/not sent for automatic reading/);
  });

  it("a PDF reaches this step only when local reading found nothing usable — its intro says so and still offers manual entry", () => {
    expect(CODE).toContain('setKind === "PDF" ? t("vehicleRegConsentIntroPdf") : t("vehicleRegConsentIntro")');
    expect(messages.en!.vehicleRegConsentIntroPdf).toMatch(/could not be read locally/);
  });
});

describe("the full disclosure — the Privacy Policy's automatic-reading section (moved verbatim)", () => {
  it.each(LOCALES)("%s carries every policy point, non-empty", (locale) => {
    for (const key of POLICY_KEYS) expect(policy[locale]![key]!.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
  });

  it("English names the processor, what is sent (incl. owner data), outside Oman, single purpose, accuracy, declining, retention", () => {
    const en = policy.en!;
    for (const k of ["processor", "processorPdf", "processorImages"]) {
      expect(en[k], k).toMatch(/external processing provider \(Anthropic\)/);
      expect(en[k], k).toMatch(/owner's name and civil number/);
    }
    expect(en.geoGlobal).toMatch(/outside Oman/);
    expect(en.geoGlobal).toMatch(/United States or other countries/);
    expect(en.purpose).toMatch(/only purpose/);
    expect(en.accuracy).toMatch(/inaccurate/);
    expect(en.decline).toMatch(/never blocks/);
    expect(en.retention).toMatch(/provider's terms/);
    expect(en.limits).toMatch(/does not verify ownership/);
  });

  it("the policy page renders every point (the broader geography sentence — true for every configured region) and never imports the reader factory", () => {
    expect(PRIVACY_PAGE).toMatch(/const reading = \["processor", "processorPdf", "processorImages", "geoGlobal", "purpose", "accuracy", "decline", "retention", "limits", "recorded"\] as const;/);
    expect(PRIVACY_PAGE).not.toMatch(/get-registration-document-reader|claude-vision-reader|process\.env/);
  });

  it("the retention point states no retention tier or period (privacy-gate precondition still open)", () => {
    for (const l of LOCALES) expect(policy[l]!.retention, l).not.toMatch(/30|zero[- ]data|ZDR|\bdays\b|يوماً|Tage|giorni|\bdni\b|jours|dnů|дней/i);
  });

  it("Arabic policy points are real Arabic, name the processor and Oman, keep the brand spelling", () => {
    const ar = policy.ar!;
    expect(ar.processor).toContain("Anthropic");
    expect(ar.processor).toContain("برق");
    expect(ar.geoGlobal).toMatch(/عُمان|عمان/);
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });
});

describe("2026-10-16 correction — bounded desktop actions, honest header on failure", () => {
  it("8. from 640 px the two actions form ONE centred row with bounded widths: primary 280–320 px, manual 224–280 px; the hint takes its own line", () => {
    expect(CODE).toMatch(/export const CONSENT_PRIMARY_WIDTH = "w-full sm:w-auto sm:min-w-\[17\.5rem\] sm:max-w-80";/); // 280 / 320 px
    expect(CODE).toMatch(/export const CONSENT_SECONDARY_WIDTH = "w-full sm:w-auto sm:min-w-56 sm:max-w-\[17\.5rem\] sm:border sm:border-primary\/25";/); // 224 / 280 px
    expect(CODE).toMatch(/<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">/);
    expect(CODE).toMatch(/className=\{`\$\{JOURNEY_PRIMARY\} \$\{CONSENT_PRIMARY_WIDTH\}`\}/);
    expect(CODE).toMatch(/<p id="consent-needs-authorization" className="text-center text-sm text-foreground\/70 sm:order-last sm:basis-full">/);
    // no truncation: labels wrap rather than being cut
    expect(stripComments(CODE)).not.toMatch(/truncate|whitespace-nowrap|text-ellipsis/);
  });

  it("9. under 640 px nothing changes: both actions full width, primary first, manual below, 48 px", () => {
    expect(CODE).toMatch(/CONSENT_PRIMARY_WIDTH = "w-full /);
    expect(CODE).toMatch(/CONSENT_SECONDARY_WIDTH = "w-full /);
    const actions = CODE.slice(CODE.indexOf("<div className=\"flex flex-col gap-2 sm:flex-row"));
    expect(actions.indexOf('run("read")')).toBeLessThan(actions.indexOf('run("manual")'));
    // the bounded widths only ever apply from the sm breakpoint
    for (const w of [/CONSENT_PRIMARY_WIDTH = "([^"]*)"/, /CONSENT_SECONDARY_WIDTH = "([^"]*)"/]) {
      const classes = CODE.match(w)![1]!.split(" ").filter((c) => c !== "w-full");
      for (const c of classes) expect(c, c).toMatch(/^sm:/);
    }
  });

  it("1. a failed attempt INSIDE the step is mirrored by the header (step 2 current + error) — presentation only, no request", () => {
    expect(CODE).toMatch(/const journey = useJourneyStatus\(\);/);
    expect(CODE).toMatch(/if \(which === "read"\) journey\?\.setReadingFailed\(false\);/);
    expect(CODE).toMatch(/if \(which === "read" && code\) journey\?\.setReadingFailed\(true\);/);
    // a decline error is not a reading failure
    expect((CODE.match(/setReadingFailed\(true\)/g) ?? []).length).toBe(1);
  });
});
