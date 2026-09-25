import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 3C Slice C2d-R1 Checkpoint B — translation-QUALITY gate for the create/edit/calendar/lifecycle
// keys (the repo-wide parity test already covers key-set parity + non-empty + no marker for ALL keys).
// This guards specifically against English stopgaps silently returning in the six non-English locales,
// and against ICU placeholder drift.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
type Loc = (typeof LOCALES)[number];
const M = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(process.cwd(), "messages", l, "provider.json"), "utf8"))]),
) as Record<Loc, Record<string, string>>;

describe("C2d-R1 Checkpoint B provider translations", () => {
  it("ICU placeholders are identical across all locales", () => {
    const placeholders: Record<string, string[]> = {
      rentalCalSelectedCount: ["{count}"],
      rentalCalConfirmOpen: ["{count}", "{range}"],
      rentalCalConfirmReopen: ["{count}", "{range}"],
      rentalCalConfirmBlock: ["{count}", "{range}"],
      rentalCalConfirmSetOverride: ["{range}"],
      rentalCalConfirmClearOverride: ["{range}"],
      rentalCreateListTruncated: ["{count}"],
    };
    for (const [key, tokens] of Object.entries(placeholders)) {
      for (const locale of LOCALES) {
        for (const token of tokens) {
          expect(M[locale][key], `${locale}.${key} keeps ${token}`).toContain(token);
        }
      }
    }
  });

  it("meaningful phrases are genuinely translated (not English copies) in the six non-English locales", () => {
    const phraseKeys = [
      "rentalCapacityOverrideHint", "rentalCurrencyLockedHint", "rentalConfirmArchive", "rentalConfirmSuspend",
      "rentalConfirmPublish", "rentalErrorResourceUnavailable", "rentalErrorOfferingAlreadyActive", "rentalErrorDayNotFound",
      "rentalArchivedReadOnly", "rentalCalConfirmReopen", "rentalCalendarHeading", "rentalCreateNoServices",
      "rentalCreateListTruncated", "rentalCurrencyLockedHint",
    ];
    for (const locale of ["de", "fr", "it", "pl", "ru", "cs"] as const) {
      for (const key of phraseKeys) {
        expect(M[locale][key], `${locale}.${key} differs from English`).not.toBe(M.en[key]);
      }
    }
  });

  it("the capacity hint keeps the 'never changes the price' guarantee in English and stays non-empty everywhere", () => {
    expect((M.en.rentalCapacityOverrideHint ?? "").toLowerCase()).toContain("never changes the price");
    for (const locale of LOCALES) expect((M[locale].rentalCapacityOverrideHint ?? "").trim().length).toBeGreaterThan(0);
  });
});
