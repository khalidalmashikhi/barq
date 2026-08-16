import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Gate 1A — guards that the new submission-workflow strings exist (non-empty) in
// every supported locale, so the verification / application pages never render a
// raw key. Reads the message files from disk (repo root) rather than importing
// them, to avoid bundling all locales into the test.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

const PROVIDER_KEYS = [
  "applicationStatusDraft",
  "applicationStatusDraftBody",
  "applicationContinueVerificationLink",
  "verificationSubmitTitle",
  "verificationSubmitIntro",
  "verificationSubmitButton",
  "verificationSubmitDisabledHint",
  "verificationSubmitNotice",
  "verificationSubmitNotReady",
  "verificationSubmitInvalidState",
  "verificationUnderReviewNote",
] as const;

const ADMIN_KEYS = ["statusDraft"] as const;

function load(locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/${ns}.json`), "utf8"));
}

describe("Gate 1A submission workflow — i18n key parity", () => {
  for (const locale of LOCALES) {
    it(`${locale}/provider.json defines all submission keys as non-empty strings`, () => {
      const json = load(locale, "provider");
      for (const key of PROVIDER_KEYS) {
        expect(typeof json[key], `${locale} provider missing ${key}`).toBe("string");
        expect((json[key] as string).length).toBeGreaterThan(0);
      }
    });

    it(`${locale}/admin.json defines the DRAFT status label`, () => {
      const json = load(locale, "admin");
      for (const key of ADMIN_KEYS) {
        expect(typeof json[key], `${locale} admin missing ${key}`).toBe("string");
        expect((json[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});
