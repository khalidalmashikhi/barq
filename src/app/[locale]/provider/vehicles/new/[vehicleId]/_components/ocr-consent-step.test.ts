import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The standalone processing notice + choice step. Structural checks on the component (Vitest here
// runs without a DOM) and content checks on the copy in every supported language. Since the
// 2026-10-09 wording simplification the notice is LAYERED: the ordinary workflow speaks only of
// "automatic reading" (neutral, no vendor, no "AI"), while the full notice — processor identity,
// what is sent, geography, purpose, limits, retention, policy — sits behind "Privacy details".

const ROOT = process.cwd();
const CODE = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx"), "utf8");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/provider.json`), "utf8")) as Record<string, string>]));

/** Copy the provider sees in the ORDINARY workflow (without opening "Privacy details"). */
const ORDINARY_KEYS = [
  "vehicleRegConsentTitle",
  "vehicleRegConsentIntro",
  "vehicleRegConsentIntroPdf",
  "vehicleRegConsentDisclosure",
  "vehicleRegConsentAccuracy",
  "vehicleRegConsentDetailsToggle",
  "vehicleRegConsentOwnerLabel",
  "vehicleRegConsentReadButton",
  "vehicleRegConsentManualButton",
  "vehicleRegConsentPending",
  "vehicleRegConsentDeclinedNotice",
  "vehicleRegConsentChangeMind",
  "vehicleRegConsentStaleNotice",
];
/** Copy behind "Privacy details". */
const DETAIL_KEYS = [
  "vehicleRegConsentNoticeTitle",
  "vehicleRegConsentPointProcessor",
  "vehicleRegConsentPointProcessorPdf",
  "vehicleRegConsentPointProcessorImages",
  "vehicleRegConsentPointGeoUs",
  "vehicleRegConsentPointGeoGlobal",
  "vehicleRegConsentPointPurpose",
  "vehicleRegConsentPointAccuracy",
  "vehicleRegConsentPointDecline",
  "vehicleRegConsentPointRetention",
  "vehicleRegConsentLimits",
  "vehicleRegConsentLegalNote",
  "vehicleRegConsentPrivacyPolicyLink",
];
const NOTICE_KEYS = [...ORDINARY_KEYS, ...DETAIL_KEYS];
const RESULT_KEYS = ["vehicleRegOcrNotAvailable", "vehicleRegConsentOwnerRequired", "vehicleRegStateAwaitingChoice", "vehicleRegExtractFailOcrRateLimited", "vehicleRegExtractFailOcrAttemptLimit"];

// Vendor / technology / geography wording that must NOT appear in the ordinary workflow. The
// technology abbreviations are matched CASE-SENSITIVELY (upper case only): "ai" is an ordinary
// Italian word, "ia"/"si" occur in several languages.
const TECH_ABBREVIATIONS = /AI|KI|IA|ИИ/;
const VENDOR_OR_AI_WORDS = /anthropic|claude|الذكاء الاصطناعي|ذكاء اصطناعي|artificial intelligence|intelligence artificielle|künstliche intelligenz|intelligenza artificiale|sztuczn|umělá inteligence|искусственн|american servers|US servers|خوادم أمريكية|الخوادم الأمريكية|الولايات المتحدة|united states|vereinigten staaten|stati uniti|états-unis|stanach zjednoczonych|spojených státech|сша/i;
const expectNoVendorOrAi = (value: string, label: string) => {
  expect(value, label).not.toMatch(TECH_ABBREVIATIONS);
  expect(value, label).not.toMatch(VENDOR_OR_AI_WORDS);
};

describe("OcrConsentStep — structure", () => {
  it("is a client island that renders every notice key and offers exactly the two choices", () => {
    expect(CODE).toMatch(/^"use client";/);
    for (const key of NOTICE_KEYS) expect(CODE, key).toContain(`"${key}"`);
    expect(CODE).toContain("grantOcrConsentAction(vehicleId, ownerAuthorized)");
    expect(CODE).toContain("declineOcrConsentAction(vehicleId)");
  });

  it("the 'continue with automatic reading' button stays disabled until the owner/authorized box is ticked; both buttons lock while pending", () => {
    expect(CODE).toMatch(/disabled=\{pending \|\| !ownerAuthorized\}/);
    expect(CODE).toMatch(/onClick=\{\(\) => run\("manual"\)\} disabled=\{pending\}/);
    expect(CODE).toMatch(/type="checkbox" checked=\{ownerAuthorized\}/);
  });

  it("chooses the geography sentence from the configured geography — never from a default", () => {
    expect(CODE).toContain('inferenceGeo === "us" ? t("vehicleRegConsentPointGeoUs") : t("vehicleRegConsentPointGeoGlobal")');
    expect(CODE).not.toMatch(/inferenceGeo\s*=\s*"us"|inferenceGeo \?\? /);
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
    expect((CODE.match(/grantOcrConsentAction\(/g) ?? []).length).toBe(1); // the single call inside run("read") (the import has no call parentheses)
    expect(CODE).toMatch(/which === "read" \? await grantOcrConsentAction\(vehicleId, ownerAuthorized\)/);
  });
});

describe("layering — the ordinary workflow vs. the privacy details", () => {
  it("the short disclosure and the accuracy statement are rendered OUTSIDE the details element; the full notice is INSIDE it, behind the 'Privacy details' summary", () => {
    const details = CODE.indexOf("<details");
    const detailsEnd = CODE.indexOf("</details>");
    expect(details).toBeGreaterThan(0);
    expect(detailsEnd).toBeGreaterThan(details);
    const summary = CODE.indexOf("<summary");
    expect(summary).toBeGreaterThan(details);
    expect(CODE.indexOf('t("vehicleRegConsentDetailsToggle")')).toBeGreaterThan(summary);
    for (const key of ["vehicleRegConsentDisclosure", "vehicleRegConsentAccuracy", "vehicleRegConsentOwnerLabel", "vehicleRegConsentReadButton", "vehicleRegConsentManualButton", "vehicleRegConsentTitle"]) {
      const at = CODE.indexOf(`t("${key}")`);
      expect(at < details || at > detailsEnd, `${key} must be outside <details>`).toBe(true);
    }
    for (const key of ["vehicleRegConsentNoticeTitle", "vehicleRegConsentPointGeoUs", "vehicleRegConsentPointPurpose", "vehicleRegConsentPointRetention", "vehicleRegConsentLimits", "vehicleRegConsentLegalNote", "vehicleRegConsentPrivacyPolicyLink"]) {
      const at = CODE.indexOf(`t("${key}")`);
      expect(at > details && at < detailsEnd, `${key} must be inside <details>`).toBe(true);
    }
    expect(CODE.indexOf("t(PROCESSOR_POINT_KEY[setKind])")).toBeGreaterThan(details);
  });

  it("the privacy details are reachable from the step itself (a native disclosure, no sign-in, no second page) and link to the privacy policy", () => {
    expect(CODE).toMatch(/<details[^>]*open=\{mode === "stale"\}/); // closed by default; opened when the notice changed
    expect(CODE).toContain('<Link href="/privacy"');
  });
});

describe("the ordinary workflow copy — neutral 'automatic reading' wording, in every language", () => {
  it.each(LOCALES)("%s has every notice and result key, non-empty", (locale) => {
    for (const key of [...NOTICE_KEYS, ...RESULT_KEYS]) {
      expect(typeof messages[locale]![key], `${locale}.${key}`).toBe("string");
      expect(messages[locale]![key]!.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)("%s: no vendor name, no 'AI', no engine, no 'American servers' / country in the ordinary workflow keys or the state/result labels", (locale) => {
    const m = messages[locale]!;
    const ordinary = [...ORDINARY_KEYS, ...RESULT_KEYS, "vehicleOnboardOcrNotice", "vehicleOnboardManualNotice", "vehicleRegReviewSubtitle", "vehicleRegReviewErrExtraction"];
    for (const key of ordinary) {
      if (typeof m[key] !== "string") continue;
      expectNoVendorOrAi(m[key]!, `${locale}.${key}`);
    }
  });

  it("every provider-workflow key (vehicleReg*/vehicleOnboard*/vehicleDoc*) outside the privacy details is free of vendor / AI wording — in every language", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale]!)) {
        if (!/^(vehicleReg|vehicleOnboard|vehicleDoc)/.test(key) || DETAIL_KEYS.includes(key)) continue;
        expectNoVendorOrAi(value, `${locale}.${key}`);
      }
    }
  });

  it("Arabic uses exactly the approved wording: heading, explanation, attestation, both buttons, disclosure and accuracy", () => {
    const ar = messages.ar!;
    expect(ar.vehicleRegConsentTitle).toBe("قراءة بيانات المركبة تلقائياً");
    expect(ar.vehicleRegConsentIntro).toBe("يمكن للنظام قراءة بيانات المركبة من المستند وتعبئة النموذج لتراجعه قبل الحفظ. يمكنك بدلاً من ذلك إدخال البيانات يدوياً.");
    expect(ar.vehicleRegConsentOwnerLabel).toBe("أؤكد أنني مالك المركبة أو مخوّل باستخدام مستندها لإضافة المركبة.");
    expect(ar.vehicleRegConsentReadButton).toBe("متابعة القراءة التلقائية");
    expect(ar.vehicleRegConsentManualButton).toBe("إدخال البيانات يدوياً");
    expect(ar.vehicleRegConsentDisclosure).toBe("عند اختيار القراءة التلقائية، ستُعالج نسخة المستند لاستخراج بيانات المركبة، وقد تتم المعالجة عبر مزود خدمة خارجي خارج سلطنة عُمان. راجع البيانات قبل الحفظ.");
    expect(ar.vehicleRegConsentAccuracy).toBe("البيانات المستخرجة اقتراحات للمراجعة، ولا تثبت الملكية ولا تعني اعتماد المركبة.");
    expect(ar.vehicleRegConsentDetailsToggle).toBe("تفاصيل الخصوصية");
    for (const key of NOTICE_KEYS) expect(ar[key], key).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });

  it("English: neutral 'automatic reading' heading and buttons; the disclosure says a copy is processed, possibly by an external service provider outside Oman; the accuracy line disclaims ownership and approval", () => {
    const en = messages.en!;
    expect(en.vehicleRegConsentTitle).toMatch(/automatically/i);
    expect(en.vehicleRegConsentReadButton).toBe("Continue with automatic reading");
    expect(en.vehicleRegConsentManualButton).toBe("Enter the details manually");
    expect(en.vehicleRegConsentDetailsToggle).toBe("Privacy details");
    expect(en.vehicleRegConsentDisclosure).toMatch(/copy of the document is processed/);
    expect(en.vehicleRegConsentDisclosure).toMatch(/external service provider outside Oman/);
    expect(en.vehicleRegConsentDisclosure).toMatch(/Review the details before saving/);
    expect(en.vehicleRegConsentAccuracy).toMatch(/do not prove ownership/);
    expect(en.vehicleRegConsentAccuracy).toMatch(/do not mean the vehicle is approved/);
    expect(en.vehicleRegConsentOwnerLabel).toMatch(/owner or authorized/);
  });

  it.each(LOCALES)("%s: nothing claims the processing happens only in Oman, or that BARQ performs all of it", (locale) => {
    const all = NOTICE_KEYS.map((k) => messages[locale]![k]!).join("\n");
    expect(all).not.toMatch(/only (in|within) Oman|exclusively in Oman|nur in Oman|solo in Oman|uniquement (en|à) Oman|tylko w Omanie|pouze v Ománu|только в Омане|فقط داخل (سلطنة )?عُ?مان|داخل (سلطنة )?عُ?مان فقط/i);
    expect(all).not.toMatch(/BARQ (performs|does|carries out) all|entirely by BARQ|برق وحدها|بالكامل داخل برق/i);
  });

  it("the declined notice promises only what the server guarantees: the document is not SENT for automatic reading", () => {
    expect(messages.en!.vehicleRegConsentDeclinedNotice).toMatch(/not sent for automatic reading/);
  });

  it("the 'awaiting choice' state label is not a failure word", () => {
    expect(messages.en!.vehicleRegStateAwaitingChoice).not.toMatch(/fail|error|could not/i);
  });

  it("a PDF reaches this step only when local reading found nothing usable — its intro says so and still offers manual entry", () => {
    expect(CODE).toContain('setKind === "PDF" ? t("vehicleRegConsentIntroPdf") : t("vehicleRegConsentIntro")');
    expect(messages.en!.vehicleRegConsentIntroPdf).toMatch(/could not be read locally/);
    expect(messages.en!.vehicleRegConsentIntroPdf).toMatch(/enter the details manually/);
  });
});

describe("the privacy details — accurate and complete, in every language", () => {
  it("English states each required point: the external processing provider by legal name, what is sent, outside Oman, single purpose, may be wrong + provider confirms, decline allowed and never blocking, retention governed by the provider's terms", () => {
    const en = messages.en!;
    expect(en.vehicleRegConsentPointProcessor).toMatch(/external processing provider \(Anthropic\)/);
    expect(en.vehicleRegConsentPointProcessor).toMatch(/complete registration document/);
    expect(en.vehicleRegConsentPointProcessor).toMatch(/owner's name and civil number/);
    expect(en.vehicleRegConsentPointGeoUs).toMatch(/outside Oman/);
    expect(en.vehicleRegConsentPointGeoUs).toMatch(/United States/);
    expect(en.vehicleRegConsentPointGeoGlobal).toMatch(/outside Oman/);
    expect(en.vehicleRegConsentPointGeoGlobal).toMatch(/other countries/);
    expect(en.vehicleRegConsentPointPurpose).toMatch(/only purpose/);
    expect(en.vehicleRegConsentPointAccuracy).toMatch(/inaccurate/);
    expect(en.vehicleRegConsentPointAccuracy).toMatch(/confirm every value/);
    expect(en.vehicleRegConsentPointDecline).toMatch(/decline/);
    expect(en.vehicleRegConsentPointDecline).toMatch(/never blocks/);
    expect(en.vehicleRegConsentPointRetention).toMatch(/this reading only/);
    expect(en.vehicleRegConsentPointRetention).toMatch(/provider's terms/);
  });

  it("the retention sentence states no retention tier or period (precondition 3 of the privacy gate is still open) — it defers to the provider's terms", () => {
    for (const locale of LOCALES) expect(messages[locale]!.vehicleRegConsentPointRetention, locale).not.toMatch(/30|zero[- ]data|ZDR|\bdays\b|يوماً|Tage|giorni|\bdni\b|jours|dnů|дней/i);
  });

  it("the processor sentences never call the provider an 'AI processor' (vendor identity is kept; the technology label is not); the geography sentence names no 'servers'", () => {
    for (const locale of LOCALES) {
      for (const key of ["vehicleRegConsentPointProcessor", "vehicleRegConsentPointProcessorPdf", "vehicleRegConsentPointProcessorImages"]) {
        expect(messages[locale]![key], `${locale}.${key}`).not.toMatch(/\bAI\b|\bKI\b|\bIA\b|\bИИ\b|الذكاء الاصطناعي/);
      }
    }
    expect(messages.en!.vehicleRegConsentPointGeoUs).not.toMatch(/servers/);
    expect(messages.ar!.vehicleRegConsentPointGeoUs).not.toMatch(/خوادم/);
  });

  it("English says what automatic reading does NOT do: verify ownership, approve the vehicle, replace BARQ's review — and that it can be wrong", () => {
    const limits = messages.en!.vehicleRegConsentLimits!;
    expect(limits).toMatch(/does not verify ownership/);
    expect(limits).toMatch(/does not approve the vehicle/);
    expect(limits).toMatch(/does not replace BARQ's review/);
    expect(limits).toMatch(/incorrect values/);
  });

  it("the legal note is cautious: it describes the processing and the record; it does not claim the notice makes anything lawful or compliant", () => {
    for (const locale of LOCALES) {
      expect(messages[locale]!.vehicleRegConsentLegalNote).not.toMatch(/compliant|compliance|lawful|legally binding|GDPR|PDPL/i);
    }
  });

  it("Arabic details are real Arabic and name the processor and Oman; the brand spelling is kept", () => {
    const ar = messages.ar!;
    for (const key of DETAIL_KEYS) expect(ar[key], key).toMatch(/[؀-ۿ]/);
    expect(ar.vehicleRegConsentPointProcessor).toContain("Anthropic");
    expect(ar.vehicleRegConsentPointGeoUs).toMatch(/عُمان|عمان/);
    expect(ar.vehicleRegConsentPointProcessor).toContain("برق");
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });
});

describe("OcrConsentStep — the notice names exactly what would be sent (the set)", () => {
  it("chooses the processor sentence from the set kind — the selected PDF, the photo, or ALL selected photos together", () => {
    expect(CODE).toContain('PDF: "vehicleRegConsentPointProcessorPdf"');
    expect(CODE).toContain('IMAGE: "vehicleRegConsentPointProcessor"');
    expect(CODE).toContain('IMAGES: "vehicleRegConsentPointProcessorImages"');
    expect(CODE).toContain("t(PROCESSOR_POINT_KEY[setKind])");
    expect(CODE).toMatch(/setKind: "PDF" \| "IMAGE" \| "IMAGES";/); // required — never defaulted to a generic sentence
  });

  it("English: the PDF variant names the selected PDF; the photos variant says all selected images are sent together (front and back); each still names the processor and the owner data", () => {
    const en = messages.en!;
    expect(en.vehicleRegConsentPointProcessorPdf).toMatch(/selected PDF/);
    expect(en.vehicleRegConsentPointProcessorImages).toMatch(/All selected images are sent together/);
    expect(en.vehicleRegConsentPointProcessorImages).toMatch(/front and back/);
    for (const key of ["vehicleRegConsentPointProcessorPdf", "vehicleRegConsentPointProcessorImages", "vehicleRegConsentPointProcessor"]) {
      expect(en[key], key).toMatch(/external processing provider \(Anthropic\)/);
      expect(en[key], key).toMatch(/owner's name and civil number/);
    }
  });

  it.each(LOCALES)("%s: the three processor sentences differ from each other and all name the processor", (locale) => {
    const m = messages[locale]!;
    const three = [m.vehicleRegConsentPointProcessor!, m.vehicleRegConsentPointProcessorPdf!, m.vehicleRegConsentPointProcessorImages!];
    expect(new Set(three).size).toBe(3);
    for (const s of three) expect(s).toContain("Anthropic");
  });

  it("Arabic variants are real Arabic, mention the PDF / both sides, and keep the brand spelling", () => {
    const ar = messages.ar!;
    expect(ar.vehicleRegConsentPointProcessorPdf).toMatch(/[؀-ۿ]/);
    expect(ar.vehicleRegConsentPointProcessorPdf).toContain("PDF");
    expect(ar.vehicleRegConsentPointProcessorImages).toMatch(/الوجه الأمامي والخلفي/);
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });
});
