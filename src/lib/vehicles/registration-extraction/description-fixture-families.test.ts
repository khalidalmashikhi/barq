import { describe, it, expect, vi, afterEach } from "vitest";
import { parseOmanVehicleRegistration, buildRegistrationExtraction } from "./parse-registration";
import { splitVehicleDescription } from "./vehicle-description";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";

// The twelve required SYNTHETIC fixture families for the native-PDF decomposition (2026-10-09
// correction), each run through BOTH tiers (native text and OCR candidates) to prove the shared
// deterministic stage behaves identically. Never a real registration: brands are real names,
// models are generic, no plate / VIN / owner / civil number / address appears.

const fetchGuard = vi.fn(() => {
  throw new Error("OUTBOUND REQUEST ATTEMPTED");
});
vi.stubGlobal("fetch", fetchGuard);
afterEach(() => expect(fetchGuard).not.toHaveBeenCalled());

const native = (desc: string, extra: string[] = []) => parseOmanVehicleRegistration(["نوع المركبة: " + desc, "الموديل: 2019", "اللون: أبيض", ...extra].join("\n"));
const ocr = (desc: string, extra: Record<string, { text: string }[]> = {}) => buildRegistrationExtraction({ vehicleDescription: [{ text: desc }], manufactureYear: [{ text: "2019" }], ...extra }, { source: "OCR" });

type Expect = { make: string | null; model: string | null; type?: string | null };
const FAMILIES: [string, string, Expect][] = [
  ["1. manufacturer + saloon + numeric model", "مازدا صالون 6", { make: "Mazda", model: "6", type: "SEDAN" }],
  ["2. body style + manufacturer + numeric model", "صالون مازدا 3", { make: "Mazda", model: "3", type: "SEDAN" }],
  ["3. manufacturer + SUV + multiword model", "تويوتا رباعي لاند كروزر", { make: "Toyota", model: "لاند كروزر", type: "SUV" }],
  ["4. English description", "TOYOTA SALOON CAMRY", { make: "Toyota", model: "CAMRY", type: "SEDAN" }],
  ["5. bilingual description", "Nissan صالون Sunny", { make: "Nissan", model: "Sunny", type: "SEDAN" }],
  ["6. Arabic presentation-form glyphs", "ﻣﺎﺯﺩﺍ ﺻﺎﻟﻮﻥ ٦", { make: "Mazda", model: "٦", type: "SEDAN" }],
  ["7. tatweel and diacritics", "مَــازْدَا صـَالُون 6", { make: "Mazda", model: "6", type: "SEDAN" }],
  ["8. embedded bidi/control marks", "‫مازدا‬ ‏صالون‎ ⁦500⁩", { make: "Mazda", model: "500", type: "SEDAN" }],
  ["9. unknown manufacturer", "سيارةخاصة صالون 9", { make: null, model: null, type: "SEDAN" }],
  ["10. two competing manufacturer aliases", "تويوتا نيسان صالون 300", { make: null, model: null, type: "SEDAN" }],
];

describe("fixture families 1–10 — identical on the native-PDF and OCR tiers", () => {
  it.each(FAMILIES)("%s", (_name, desc, exp) => {
    for (const r of [native(desc), ocr(desc)]) {
      expect(r.fields.makeDescription.normalizedValue).toBe(exp.make);
      expect(r.fields.model.normalizedValue).toBe(exp.model);
      if (exp.make !== null) {
        expect(r.fields.makeDescription.confidence).toBe("LOW");
        expect(r.fields.makeDescription.warnings).toContain("HEURISTIC_SPLIT");
        expect(r.fields.model.warnings).toContain("HEURISTIC_SPLIT");
      }
      // the year is never the model; the description stays whole and private
      expect(r.fields.model.normalizedValue).not.toBe("2019");
      expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
      expect(r.fields.vehicleDescription.normalizedValue).not.toBeNull();
    }
    // the type is only ever a suggestion computed for review — never a field of the reading
    if (exp.type !== undefined) expect(suggestVehicleType(desc)).toBe(exp.type);
  });
});

describe("fixture families 11–12 — explicit labelled fields and the description", () => {
  it("11. explicit make/model AGREEING with the description → the explicit values stand (not heuristic), no conflict", () => {
    const r = native("مازدا صالون 6", ["الماركة: مازدا", "الطراز: 6"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Mazda" });
    expect(r.fields.makeDescription.warnings).not.toContain("HEURISTIC_SPLIT");
    expect(r.fields.model.normalizedValue).toBe("6");
    expect(r.fields.model.warnings).not.toContain("CONFLICT");
    const o = ocr("مازدا صالون 6", { makeDescription: [{ text: "مازدا" }], model: [{ text: "6" }] });
    expect(o.fields.makeDescription.normalizedValue).toBe("Mazda");
    expect(o.fields.model.normalizedValue).toBe("6");
  });

  it("12. explicit make/model CONFLICTING with the description → a reviewable conflict with both values; nothing silently selected", () => {
    for (const r of [native("مازدا صالون 6", ["الطراز: 3"]), ocr("مازدا صالون 6", { model: [{ text: "3" }] })]) {
      expect(r.fields.model).toMatchObject({ normalizedValue: null, confidence: "LOW", alternatives: ["3", "6"] });
      expect(r.fields.model.warnings).toEqual(expect.arrayContaining(["CONFLICT", "EXPLICIT_VS_DERIVED"]));
    }
  });
});

describe("the 2026-10-09 staging gaps (letter variants, glued and fragmented manufacturers)", () => {
  it.each([
    ["Persian yeh ی", "تویوتا صالون كامري", "Toyota", "كامري"],
    ["keheh ک", "کيا صالون ريو", "Kia", "ريو"],
    ["alef maksura ى", "هيونداى صالون اكسنت", "Hyundai", "اكسنت"],
    ["Farsi-yeh presentation glyph", "ﺗﻮﯾﻮﺗﺎ صالون كامري", "Toyota", "كامري"],
    ["manufacturer glued to a digit (Arabic)", "مازدا6 صالون", "Mazda", "6"],
    ["manufacturer glued to a digit (Latin)", "MAZDA6 SALOON", "Mazda", "6"],
    ["manufacturer joined by a hyphen", "مازدا-6 صالون", "Mazda", "6"],
    ["manufacturer split by a PDF text-run gap", "ماز دا صالون 6", "Mazda", "6"],
  ])("%s → make %s, model %s (both tiers)", (_n, desc, make, model) => {
    for (const r of [native(desc), ocr(desc)]) {
      expect(r.fields.makeDescription.normalizedValue).toBe(make);
      expect(r.fields.model.normalizedValue).toBe(model);
    }
  });

  it("fragment rejoining never fires when a manufacturer is found normally, never joins known words, and never joins digits", () => {
    expect(splitVehicleDescription("مازدا صالون 6")).toMatchObject({ ok: true, split: { make: "Mazda", model: "6" } });
    expect(splitVehicleDescription("ماز 6 دا صالون")).toEqual({ ok: false, reason: "UNKNOWN_MANUFACTURER" });
    expect(splitVehicleDescription("صال ون فان")).toMatchObject({ ok: false });
  });

  it("a model whose letters merely START like a manufacturer is not split (only an exact alias + digits)", () => {
    // "كياسو" is not "كيا" + digits → no manufacturer recognized, nothing invented
    expect(splitVehicleDescription("كياسو صالون")).toEqual({ ok: false, reason: "UNKNOWN_MANUFACTURER" });
  });
});
