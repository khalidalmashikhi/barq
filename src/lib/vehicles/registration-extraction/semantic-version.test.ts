import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { REGISTRATION_PARSER_VERSION } from "./constants";
import { parseOmanVehicleRegistration, buildRegistrationExtraction } from "./parse-registration";
import { REGISTRATION_LABELS, REGISTRATION_PII_LABELS } from "./labels";
import { MANUFACTURER_REGISTRY } from "./manufacturer-registry";
import { BODY_STYLE_REGISTRY } from "./body-style-registry";
import { splitVehicleDescription } from "./vehicle-description";

// SEMANTIC-ANALYSIS VERSION GUARD (2026-10-09 staging finding).
//
// The deterministic stage's output is what a stored extraction is reused for. Commit 1fc340c
// changed normalization, the registries and the splitter while keeping version "1.1.0", so rows
// read under the OLD rules kept being reused as if they were current. This test makes that
// impossible to repeat: it fingerprints the output of the whole deterministic stage over a fixed
// SYNTHETIC corpus (no real document text), together with the label tables and both registries.
//
// If this test fails, the deterministic output changed. Do BOTH:
//   1. bump REGISTRATION_PARSER_VERSION in constants.ts (and say why in its comment);
//   2. record the new fingerprint below under the new version (never edit an older entry).

const FINGERPRINTS: Record<string, string> = {
  "1.2.0": "0cbe26f71f401e12f18fb402dd557082fc4c09f7119f31ec5dff163d9e36ea5a",
};

const DESCRIPTIONS = [
  "مازدا صالون 6",
  "صالون مازدا 6",
  "تويوتا رباعي لاند كروزر",
  "Toyota Station Modelname",
  "MAZDA6 SALOON",
  "مازدا-6 صالون",
  "ماز دا صالون 6",
  "تویوتا صالون کامري",
  "هيونداى صالون اكسنت",
  "ﻣﺎﺯﺩﺍ ﺻﺎﻟﻮﻥ ٦",
  "مــازدا صـالون 6",
  "مَازْدَا صَالُون 6",
  "‏مازدا‎ صالون 6",
  "فلان صالون 9",
  "تويوتا نيسان صالون",
  "نيسان بيك أب 2019",
  "Nissan Pickup 4x4 Testpatrol",
  "مرسيدس بنز فان 300",
];

const NATIVE_DOCUMENTS = [
  ["نوع المركبة: مازدا صالون 6", "الموديل: 2019", "اللون: أبيض", "عدد الركاب: 5"],
  ["الماركة: Toyota", "الطراز: Land Cruiser", "نوع المركبة: تويوتا رباعي لاند كروزر", "سنة الصنع: 2019", "عدد المقاعد: 8", "عدد الركاب: 7"],
  ["الماركة: Nissan", "نوع المركبة: نيسان صالون صني", "الطراز: Sunny GX"],
  ["Make: MAZDA", "Model: 2021", "Vehicle description: MAZDA6 SALOON", "Colour: White"],
  ["نــوع المركبــة: صالون مازدا6", "الـمـوديل: ٢٠٢٠", "اللـون: أحمر", "الاستعمال: خصوصي"],
];

const OCR_CANDIDATES = [
  { vehicleDescription: [{ text: "مازدا صالون 6" }], manufactureYear: [{ text: "2019" }], color: [{ text: "أبيض" }] },
  { makeDescription: [{ text: "مازدا" }], model: [{ text: "6" }, { text: "6 GXR" }], vehicleDescription: [{ text: "مازدا صالون 6 GXR" }] },
  { model: [{ text: "2018" }], vehicleDescription: [{ text: "كيا صالون ريو" }] },
];

function fingerprint(): string {
  const payload = {
    labels: REGISTRATION_LABELS,
    pii: REGISTRATION_PII_LABELS,
    manufacturers: MANUFACTURER_REGISTRY,
    bodyStyles: BODY_STYLE_REGISTRY,
    splits: DESCRIPTIONS.map((d) => splitVehicleDescription(d)),
    native: NATIVE_DOCUMENTS.map((lines) => {
      const r = parseOmanVehicleRegistration(lines.join("\n"));
      return { fields: r.fields, warnings: r.warnings, overall: r.overallStatus };
    }),
    ocr: OCR_CANDIDATES.map((c) => {
      const r = buildRegistrationExtraction(c as never, { source: "OCR" });
      return { fields: r.fields, warnings: r.warnings, overall: r.overallStatus };
    }),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

describe("semantic-analysis version guard", () => {
  it("the deterministic output over the synthetic corpus matches the fingerprint recorded for the CURRENT version — a change requires a version bump", () => {
    const actual = fingerprint();
    const recorded = FINGERPRINTS[REGISTRATION_PARSER_VERSION];
    expect(recorded, `no fingerprint recorded for REGISTRATION_PARSER_VERSION ${REGISTRATION_PARSER_VERSION}`).toBeDefined();
    expect(actual, "the deterministic stage changed its output: bump REGISTRATION_PARSER_VERSION and record the new fingerprint").toBe(recorded);
  });

  it("the fingerprint is stable across runs (pure, deterministic stage)", () => {
    expect(fingerprint()).toBe(fingerprint());
  });

  it("older versions keep their recorded fingerprints (entries are only ever added)", () => {
    expect(Object.keys(FINGERPRINTS)).toContain(REGISTRATION_PARSER_VERSION);
    for (const v of Object.values(FINGERPRINTS)) expect(v).toMatch(/^[0-9a-f]{64}$/);
  });
});
