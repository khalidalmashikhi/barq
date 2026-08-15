import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Gate 0 — guards that the new auto-upload UI strings exist (and stay non-empty)
// in every supported locale, so the control never renders a raw key. Reads the
// message files from disk (repo root) rather than importing them, to avoid
// bundling all locales into the test.

const NEW_KEYS = [
  "documentErrorUploadFailed",
  "documentUploadingLabel",
  "documentUploadCancelButton",
  "documentUploadRetryButton",
] as const;

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

describe("provider verification upload — i18n key parity (Gate 0)", () => {
  for (const locale of LOCALES) {
    it(`${locale}/provider.json defines all new upload keys as non-empty strings`, () => {
      const json = JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}/provider.json`), "utf8")) as Record<
        string,
        unknown
      >;
      for (const key of NEW_KEYS) {
        expect(typeof json[key], `${locale} missing ${key}`).toBe("string");
        expect((json[key] as string).length).toBeGreaterThan(0);
      }
    });
  }
});
