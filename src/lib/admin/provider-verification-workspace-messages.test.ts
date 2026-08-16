import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Gate 1B — guards that the admin verification-workspace + Request Changes strings
// and the provider CHANGES_REQUESTED strings exist (non-empty) in every locale.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

const ADMIN_KEYS = [
  "statusChangesRequested",
  "verificationRequiredProgress",
  "verificationAllRequiredApproved",
  "submittedAtLabel",
  "documentMissingLabel",
  "documentNotUploadedYet",
  "noVerificationRequirements",
  "requestChangesButton",
  "requestChangesReasonLabel",
  "requestChangesReasonPlaceholder",
] as const;

const PROVIDER_KEYS = [
  "verificationChangesRequestedNote",
  "applicationStatusChangesRequested",
  "applicationStatusChangesRequestedBody",
  "applicationChangesRequestedReasonLabel",
] as const;

function load(locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/${ns}.json`), "utf8"));
}

describe("Gate 1B verification workspace — i18n key parity", () => {
  for (const locale of LOCALES) {
    it(`${locale}/admin.json defines all workspace + request-changes keys`, () => {
      const json = load(locale, "admin");
      for (const key of ADMIN_KEYS) {
        expect(typeof json[key], `${locale} admin missing ${key}`).toBe("string");
        expect((json[key] as string).length).toBeGreaterThan(0);
      }
    });

    it(`${locale}/provider.json defines all CHANGES_REQUESTED keys`, () => {
      const json = load(locale, "provider");
      for (const key of PROVIDER_KEYS) {
        expect(typeof json[key], `${locale} provider missing ${key}`).toBe("string");
        expect((json[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});
