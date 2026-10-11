import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The recovery banner of the review step (2026-10-09). Structural checks on the client island
// (Vitest runs without a DOM here) and copy checks in all 8 languages.

const ROOT = process.cwd();
const DIR = "src/app/[locale]/provider/vehicles/new/[vehicleId]";
const CODE = readFileSync(path.join(ROOT, DIR, "_components/registration-recovery-banner.tsx"), "utf8");
const ACTIONS = readFileSync(path.join(ROOT, DIR, "recovery-actions.ts"), "utf8");
const PAGE = readFileSync(path.join(ROOT, DIR, "page.tsx"), "utf8");
const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const messages = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(ROOT, `messages/${l}/provider.json`), "utf8")) as Record<string, string>]));

const KEYS = [
  "vehicleRegRecoveryStale", "vehicleRegRereadButton", "vehicleRegRereadPending",
  "vehicleRegRecoveryIncomplete", "vehicleRegRecoveryIncompleteManual", "vehicleRegCompleteReadingButton",
  "vehicleRegCompletionPending", "vehicleRegCompletionInProgress", "vehicleRegCompletionAppliedNotice",
  "vehicleRegCompletedBadge", "vehicleRegConsentIntroComplete", "vehicleRegCompletionConsentRequired",
  "vehicleRegRecoveryStaleError", "vehicleRegCompletionFailed", "vehicleRegCompletionNotAvailable",
];
const TECH = /\bAI\b|\bKI\b|\bIA\b|\bИИ\b/;
const VENDOR = /anthropic|claude|الذكاء الاصطناعي|ذكاء اصطناعي|artificial intelligence|intelligence artificielle|künstliche intelligenz|intelligenza artificiale|sztuczn|umělá inteligence|искусственн|united states|الولايات المتحدة|servers|خوادم|parser|version|1\.2\.0|1\.1\.0|OCR\b/i;

describe("RegistrationRecoveryBanner — structure", () => {
  it("is a client island that imports nothing server-side (no prisma, env, reader, service, version constant)", () => {
    expect(CODE).toMatch(/^"use client";/);
    expect(CODE).not.toMatch(/@\/lib\/db|process\.env|extract-registration-service|get-registration-document-reader|claude-vision-reader|REGISTRATION_PARSER_VERSION|constants"/);
  });

  it("39. the LOCAL re-read and the optional automatic completion are DISTINCT actions with distinct labels and icons", () => {
    expect(CODE).toContain("rereadRegistrationAction(vehicleId)");
    expect(CODE).toContain("completeRegistrationReadingAction(vehicleId)");
    expect(CODE).toContain('t("vehicleRegRereadButton")');
    expect(CODE).toContain('t("vehicleRegCompleteReadingButton")');
    expect(CODE).toMatch(/<RefreshCw[^>]*\/>[\s\S]*vehicleRegRereadButton/);
    expect(CODE).toMatch(/<ScanLine[^>]*\/>[\s\S]*vehicleRegCompleteReadingButton/);
    for (const l of LOCALES) expect(messages[l]!.vehicleRegRereadButton).not.toBe(messages[l]!.vehicleRegCompleteReadingButton);
  });

  it("the re-read button appears only for STALE; the completion button only for INCOMPLETE with completion available", () => {
    expect(CODE).toMatch(/state === "STALE" && \(\s*<button type="button" onClick=\{reread\}/);
    expect(CODE).toMatch(/state === "INCOMPLETE" && completionAvailable && !askConsent && \(\s*<button type="button" onClick=\{complete\}/);
  });

  it("16/17. no current consent → the explicit consent step opens FIRST (intent complete); nothing is sent by the banner itself", () => {
    expect(CODE).toMatch(/if \(consentState !== "GRANTED"\) \{\s*setAskConsent\(true\);\s*return;\s*\}/);
    expect(CODE).toMatch(/if \(res\.code === "OCR_CONSENT_REQUIRED"\) return setAskConsent\(true\);/);
    expect(CODE).toMatch(/<OcrConsentStep[^>]*intent="complete"[^>]*onDeclined=\{\(\) => setAskConsent\(false\)\}/);
    expect(CODE).not.toMatch(/useEffect/); // never on mount / reload
  });

  it("38. the recovery status is announced accessibly (role=status, aria-live=polite); progress too", () => {
    expect((CODE.match(/role="status" aria-live="polite"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("40. every action is a full-size touch target (min-h-11) and is disabled while pending", () => {
    expect(CODE).toMatch(/const ACTION = "[^"]*min-h-11/);
    expect((CODE.match(/disabled=\{pending\}/g) ?? []).length).toBe(2);
  });

  it("errors are shown only as localized messages — never a raw code", () => {
    expect(CODE).toContain("td(registrationReviewMessageKey(errorCode))");
  });

  it("the Server Actions are thin, session-derived adapters with coded auth errors", () => {
    expect(ACTIONS).toMatch(/^"use server";/);
    expect(ACTIONS).toContain("rereadRegistrationDocument(vehicleId)");
    expect(ACTIONS).toContain("completeRegistrationReading(vehicleId)");
    expect(ACTIONS).toMatch(/UnauthenticatedError\) return \{ ok: false, code: "UNAUTHENTICATED" \}/);
  });

  it("the page renders the banner from the SERVER-derived recovery state only", () => {
    expect(PAGE).toContain("<RegistrationRecoveryBanner");
    expect(PAGE).toContain("state={review.recovery.state}");
    expect(PAGE).toContain("completionAvailable={review.recovery.completionAvailable}");
  });
});

describe("recovery copy — every language", () => {
  it.each(LOCALES)("%s has every recovery key, non-empty", (l) => {
    for (const k of KEYS) expect(messages[l]![k]?.trim().length ?? 0, `${l}.${k}`).toBeGreaterThan(0);
  });

  it.each(LOCALES)("36. %s: no vendor, AI, engine, geography, version or OCR wording in the recovery copy", (l) => {
    for (const k of KEYS) {
      expect(messages[l]![k], `${l}.${k}`).not.toMatch(TECH);
      expect(messages[l]![k], `${l}.${k}`).not.toMatch(VENDOR);
    }
  });

  it("Arabic uses exactly the approved wording", () => {
    const ar = messages.ar!;
    expect(ar.vehicleRegRecoveryStale).toBe("تتوفر طريقة أحدث لقراءة هذا المستند.");
    expect(ar.vehicleRegRereadButton).toBe("إعادة قراءة المستند");
    expect(ar.vehicleRegRecoveryIncomplete).toBe("تمت قراءة بعض البيانات فقط. يمكنك إكمال القراءة تلقائياً أو تعبئة الحقول المتبقية بنفسك.");
    expect(ar.vehicleRegCompleteReadingButton).toBe("إكمال القراءة التلقائية");
    expect(JSON.stringify(ar)).not.toContain("بارق");
  });

  it("English reads naturally and keeps the same meaning", () => {
    const en = messages.en!;
    expect(en.vehicleRegRereadButton).toBe("Read document again");
    expect(en.vehicleRegCompleteReadingButton).toBe("Complete automatic reading");
    expect(en.vehicleRegRecoveryIncomplete).toMatch(/complete the reading automatically or fill in the remaining fields yourself/);
  });

  it("37. the completion consent intro still leads to the same, complete privacy details (shared consent step)", () => {
    for (const l of LOCALES) {
      expect(messages[l]!.vehicleRegConsentDetailsToggle!.length).toBeGreaterThan(0);
      expect(messages[l]!.vehicleRegConsentPointProcessorPdf).toContain("Anthropic");
    }
  });
});
