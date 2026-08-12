import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGION_CODES } from "@/lib/regions";
import { PRICING_UNIT_CODES } from "@/lib/pricing-units";

// Core Service Enrichment, Gate 4 — every locale MUST carry a real label for every
// governorate + pricing-unit code (and the field labels/placeholders/template), so
// presentation never falls back to a raw code in any of BARQ's 8 languages
// (Gate 4, item 8). This guards the label registries and the common.json files
// against drifting out of sync.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;

function loadCommon(locale: string): Record<string, Record<string, string> | string> {
  const path = join(process.cwd(), "messages", locale, "common.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("region + pricing-unit i18n coverage", () => {
  for (const locale of LOCALES) {
    describe(`locale: ${locale}`, () => {
      const common = loadCommon(locale);
      const governorate = common.governorate as Record<string, string> | undefined;
      const pricingUnit = common.pricingUnit as Record<string, string> | undefined;

      it("has a governorate object with field label + placeholder", () => {
        expect(governorate).toBeTypeOf("object");
        expect(governorate!.fieldLabel).toBeTruthy();
        expect(governorate!.placeholder).toBeTruthy();
      });

      it("has a non-empty label for every governed governorate code", () => {
        for (const code of REGION_CODES) {
          expect(governorate![code], `${locale}.governorate.${code}`).toBeTruthy();
          // A label must not just echo the raw code.
          expect(governorate![code]).not.toBe(code);
        }
      });

      it("has a pricingUnit object with field label + placeholder", () => {
        expect(pricingUnit).toBeTypeOf("object");
        expect(pricingUnit!.fieldLabel).toBeTruthy();
        expect(pricingUnit!.placeholder).toBeTruthy();
      });

      it("has a non-empty label for every governed pricing-unit code", () => {
        for (const code of PRICING_UNIT_CODES) {
          expect(pricingUnit![code], `${locale}.pricingUnit.${code}`).toBeTruthy();
          expect(pricingUnit![code]).not.toBe(code);
        }
      });

      it("has the priceWithUnit template carrying both {price} and {unit} placeholders", () => {
        const template = common.priceWithUnit as string | undefined;
        expect(template).toBeTruthy();
        expect(template).toContain("{price}");
        expect(template).toContain("{unit}");
      });
    });
  }
});
