import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The standalone processing notice + choice step. Structural checks on the component (Vitest here
// runs without a DOM) and content checks on the copy in every supported language: the notice must
// say the things the privacy gate requires it to say, in Arabic and English first, with parity.

const ROOT = process.cwd();
const CODE = readFileSync(path.join(ROOT, "src/app/[locale]/provider/vehicles/new/[vehicleId]/_components/ocr-consent-step.tsx"), "utf8");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/provider.json`), "utf8")) as Record<string, string>]));

const NOTICE_KEYS = [
  "vehicleRegConsentTitle",
  "vehicleRegConsentIntro",
  "vehicleRegConsentNoticeTitle",
  "vehicleRegConsentPointProcessor",
  "vehicleRegConsentPointGeoUs",
  "vehicleRegConsentPointGeoGlobal",
  "vehicleRegConsentPointPurpose",
  "vehicleRegConsentPointAccuracy",
  "vehicleRegConsentPointDecline",
  "vehicleRegConsentLimits",
  "vehicleRegConsentLegalNote",
  "vehicleRegConsentOwnerLabel",
  "vehicleRegConsentReadButton",
  "vehicleRegConsentManualButton",
  "vehicleRegConsentPending",
  "vehicleRegConsentDeclinedNotice",
  "vehicleRegConsentChangeMind",
  "vehicleRegConsentStaleNotice",
];
const RESULT_KEYS = ["vehicleRegOcrNotAvailable", "vehicleRegConsentOwnerRequired", "vehicleRegStateAwaitingChoice", "vehicleRegExtractFailOcrRateLimited", "vehicleRegExtractFailOcrAttemptLimit"];

describe("OcrConsentStep — structure", () => {
  it("is a client island that renders every notice key and offers exactly the two choices", () => {
    expect(CODE).toMatch(/^"use client";/);
    for (const key of NOTICE_KEYS) expect(CODE, key).toContain(`"${key}"`);
    expect(CODE).toContain("grantOcrConsentAction(vehicleId, ownerAuthorized)");
    expect(CODE).toContain("declineOcrConsentAction(vehicleId)");
  });

  it("the 'read automatically' button stays disabled until the owner/authorized box is ticked; both buttons lock while pending", () => {
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
});

describe("the processing notice — what it must say, in every language", () => {
  it.each(LOCALES)("%s has every notice and result key, non-empty", (locale) => {
    for (const key of [...NOTICE_KEYS, ...RESULT_KEYS]) {
      expect(typeof messages[locale]![key], `${locale}.${key}`).toBe("string");
      expect(messages[locale]![key]!.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
    }
  });

  it("English states each required point: external AI processor by name, outside Oman, single purpose, may be wrong + provider confirms, decline allowed and never blocking, owner/authorized attestation", () => {
    const en = messages.en!;
    expect(en.vehicleRegConsentPointProcessor).toMatch(/external AI processor \(Anthropic\)/);
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
    expect(en.vehicleRegConsentOwnerLabel).toMatch(/owner of this vehicle/);
    expect(en.vehicleRegConsentOwnerLabel).toMatch(/authorized by the owner/);
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

  it("Arabic is real Arabic (not a placeholder or English copy) and names the processor and Oman", () => {
    const ar = messages.ar!;
    for (const key of NOTICE_KEYS) expect(ar[key], key).toMatch(/[؀-ۿ]/);
    expect(ar.vehicleRegConsentPointProcessor).toContain("Anthropic");
    expect(ar.vehicleRegConsentPointGeoUs).toMatch(/عُمان|عمان/);
    expect(ar.vehicleRegConsentPointProcessor).toContain("برق");
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });

  it("the declined notice promises only what the server guarantees: the document is not SENT for automatic reading", () => {
    expect(messages.en!.vehicleRegConsentDeclinedNotice).toMatch(/not sent for automatic reading/);
  });

  it("the 'awaiting choice' state label is not a failure word", () => {
    expect(messages.en!.vehicleRegStateAwaitingChoice).not.toMatch(/fail|error|could not/i);
  });
});
