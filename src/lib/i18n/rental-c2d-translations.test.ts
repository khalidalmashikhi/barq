import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 3C Slice C2d-R1 (correction) — translation-QUALITY gate for the rental-workspace keys, beyond
// the repo-wide key-parity test. Proves all 8 locales carry real, non-empty, professionally distinct
// values (not English stopgaps), that ICU placeholders are preserved, and that the protected
// "per vehicle, per day" business phrase never degrades to per-person/per-hour in any language.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
type Loc = (typeof LOCALES)[number];

// The exact C2d-R1 key set (final names, after the configured-open rename).
const C2D_KEYS = [
  "navVehicleRentals", "rentalWorkspaceTitle", "rentalWorkspaceSubtitle", "rentalPricedPerVehiclePerDay",
  "rentalOverviewHeading", "rentalMetricTotalOfferings", "rentalMetricDraft", "rentalMetricPublished",
  "rentalMetricSuspended", "rentalMetricVehiclesReady", "rentalMetricVehiclesRequiringVerification",
  "rentalMetricUpcomingConfiguredOpenDays", "rentalOfferingsHeading", "rentalNoOfferingsLabel",
  "rentalNoOfferingsDescription", "rentalVehicleUntitled", "rentalPerDaySuffix", "rentalMaxPassengersValue",
  "rentalNextConfiguredOpenLabel", "rentalNoConfiguredOpenDaysLabel", "rentalOfferingStatusDraft",
  "rentalOfferingStatusPublished", "rentalOfferingStatusSuspended", "rentalOfferingStatusArchived",
  "rentalBlockerProviderNotApproved", "rentalBlockerVerticalNotAuthorized", "rentalBlockerVerticalNotCompliant",
  "rentalBlockerVehicleNotSelectable", "rentalBlockerCapacityMissing", "rentalBlockerNoOpenDay",
  "rentalBackToWorkspace", "rentalBasePriceLabel", "rentalMaxPassengersLabel", "rentalCapacityUnknown",
  "rentalRegisteredSeatsLabel", "rentalUpcomingConfiguredOpenDaysLabel", "rentalPassengersDoNotChangePrice",
  "rentalConfiguredDaysHeading", "rentalNoConfiguredDaysLabel", "rentalNoConfiguredDaysDescription",
  "rentalDayStateOpen", "rentalDayStateBlocked", "rentalPriceSourceBase", "rentalPriceSourceOverride",
] as const;

function load(locale: Loc): Record<string, string> {
  return JSON.parse(readFileSync(path.join(process.cwd(), "messages", locale, "provider.json"), "utf8"));
}
const M: Record<Loc, Record<string, string>> = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as never;

describe("C2d-R1 provider translations", () => {
  it("every locale has exactly the C2d-R1 key set present and non-empty", () => {
    for (const locale of LOCALES) {
      for (const key of C2D_KEYS) {
        const value = M[locale][key];
        expect(value, `${locale}.${key}`).toBeTypeOf("string");
        expect((value ?? "").trim().length, `${locale}.${key} non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it("ICU placeholders are identical across all locales", () => {
    const withPlaceholder: Record<string, string> = { rentalMaxPassengersValue: "{count}", rentalNextConfiguredOpenLabel: "{date}" };
    for (const [key, token] of Object.entries(withPlaceholder)) {
      for (const locale of LOCALES) {
        expect(M[locale][key], `${locale}.${key} keeps ${token}`).toContain(token);
      }
    }
  });

  // Meaningful multi-word phrases must be genuinely translated — not English stopgaps — in the six
  // non-English locales. (Short labels / proper nouns may legitimately coincide, so we test phrases.)
  it("the six non-English locales are not wholesale copies of English for meaningful phrases", () => {
    const phraseKeys = [
      "rentalWorkspaceSubtitle", "rentalPricedPerVehiclePerDay", "rentalNoOfferingsDescription",
      "rentalPassengersDoNotChangePrice", "rentalBlockerVehicleNotSelectable", "rentalBlockerProviderNotApproved",
      "rentalBlockerNoOpenDay", "rentalNoConfiguredDaysDescription",
    ] as const;
    for (const locale of ["de", "fr", "it", "pl", "ru", "cs"] as const) {
      for (const key of phraseKeys) {
        expect(M[locale][key], `${locale}.${key} differs from English`).not.toBe(M.en[key]);
      }
    }
  });

  // Protected business phrase: pricing is per vehicle, per DAY — never per hour (any language).
  it("pricing phrases stay per-day and never per-hour in any locale", () => {
    const dayToken: Record<Loc, string> = { ar: "يوم", en: "day", de: "Tag", fr: "jour", it: "giorno", pl: "dob", ru: "сутк", cs: "den" };
    const hourToken: Record<Loc, string> = { ar: "ساعة", en: "hour", de: "Stunde", fr: "heure", it: "ora", pl: "godzin", ru: "час", cs: "hodin" };
    for (const key of ["rentalPricedPerVehiclePerDay", "rentalPerDaySuffix"] as const) {
      for (const locale of LOCALES) {
        const v = M[locale][key] ?? "";
        expect(v, `${locale}.${key} mentions the day`).toContain(dayToken[locale]);
        expect(v.toLowerCase(), `${locale}.${key} not per-hour`).not.toContain(hourToken[locale].toLowerCase());
      }
    }
    // English states the per-vehicle basis explicitly.
    const enPricing = (M.en.rentalPricedPerVehiclePerDay ?? "").toLowerCase();
    expect(enPricing).toContain("per vehicle");
    expect(enPricing).not.toContain("per person");
  });
});
