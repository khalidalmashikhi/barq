import { describe, it, expect, vi } from "vitest";
import { splitVehicleDescription, suggestVehicleTypeFromText, isYearLike } from "./vehicle-description";
import { parseOmanVehicleRegistration, buildRegistrationExtraction } from "./parse-registration";
import { foldForMatching, cleanValue, foldWithMap } from "./normalize";
import { MANUFACTURER_REGISTRY, canonicalManufacturer, matchManufacturerAt } from "./manufacturer-registry";
import { BODY_STYLE_REGISTRY, suggestTypeFromBodyStyles } from "./body-style-registry";
import { VEHICLE_TYPE_CODES } from "@/lib/vehicles/vehicle-type-codes";
import { mapExtractedByField } from "@/lib/vehicles/registration-review/extracted-mapping";
import { serializePersistedFields } from "./record";
import type { RegistrationCandidates } from "./types";

// The real-world discrepancy (2026-10-09): the SAME Omani card read as a native-text PDF gave an
// unresolved make/model and no type suggestion, while the two-photo OCR read suggested all three —
// because PDF text layers carry Arabic PRESENTATION-FORM glyphs / tatweel / diacritics (and may
// print the body style before the brand) that the old start-anchored dictionary did not match.
// Every fixture here is SYNTHETIC: fictional model names, no plate, VIN, owner, civil number,
// address or QR code. A fetch spy proves nothing leaves the process.

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);
const NOW = new Date("2027-01-01T00:00:00.000Z");
const native = (lines: string[]) => parseOmanVehicleRegistration(lines.join("\n"), NOW);
const ocr = (c: RegistrationCandidates) => buildRegistrationExtraction(c, { source: "OCR", now: NOW });
const one = (text: string) => [{ text }];
const prefill = (r: ReturnType<typeof native>) => mapExtractedByField(serializePersistedFields(r));

// Presentation-form spelling of "مازدا صالون" (contextual glyph code points, as PDF text layers expose them).
const PF_MAZDA_SALOON = "ﻣﺎﺯﺩﺍ ﺻﺎﻟﻮﻥ";

describe("4. Arabic / bilingual normalization before semantic matching", () => {
  it("folds presentation forms, tatweel, diacritics, bidi marks, punctuation and Arabic-Indic digits to one canonical form", () => {
    const variants = ["مازدا صالون 6", PF_MAZDA_SALOON + " 6", "مــازدا صـالون 6", "مَازْدَا صَالُون 6", "‏مازدا‎ - صالون - ٦", "مازدا،صالون/6"];
    for (const v of variants) expect(foldForMatching(v)).toBe("مازدا صالون 6");
    expect(foldForMatching("Mercedes-Benz  E 200")).toBe("mercedes benz e 200");
    expect(foldForMatching("إيسوزو")).toBe(foldForMatching("ايسوزو")); // alef unified
  });

  it("cleanValue keeps the document's visible text (canonical letters, no tatweel / bidi marks) — the original is preserved separately from the fold", () => {
    expect(cleanValue(PF_MAZDA_SALOON + " 6")).toBe("مازدا صالون 6"); // NFKC: same letters, standard code points
    expect(cleanValue("مــازدا صـالون 6")).toBe("مازدا صالون 6");
    expect(cleanValue("مَازْدَا 6")).toBe("مَازْدَا 6"); // diacritics stay visible in the stored value
  });

  it("foldWithMap maps every folded character back to the original index (so a label match cuts the value from the original)", () => {
    const line = "الماركة: مَازْدَا";
    const { folded, map } = foldWithMap(line);
    expect(folded).toBe("الماركة مازدا");
    expect(map.length).toBe(folded.length);
    expect(line.slice(map[folded.indexOf("مازدا")]!)).toBe("مَازْدَا");
  });

  it("labels printed as presentation forms or stretched with tatweel still match, and the captured value keeps its spelling", () => {
    const r = native(["نــوع المركبــة: " + PF_MAZDA_SALOON + " 6", "الـمـوديل: 2019", "اللـون: أبيض"]);
    expect(r.fields.vehicleDescription.normalizedValue).toBe("مازدا صالون 6");
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.color.normalizedValue).toBe("أبيض");
  });
});

describe("5–6. governed registries", () => {
  it("manufacturer aliases (Arabic and Latin) produce the CANONICAL name; unknown text → null", () => {
    for (const [alias, canonical] of [["mazda", "Mazda"], ["مازدا", "Mazda"], ["تويوتا", "Toyota"], ["نيسان", "Nissan"], ["هيونداي", "Hyundai"], ["كيا", "Kia"], ["فورد", "Ford"], ["شفروليه", "Chevrolet"], ["ميتسوبيشي", "Mitsubishi"], ["لكزس", "Lexus"], ["هوندا", "Honda"], ["سوزوكي", "Suzuki"], ["ايسوزو", "Isuzu"], ["إيسوزو", "Isuzu"], ["مرسيدس", "Mercedes-Benz"], ["بي ام دبليو", "BMW"], ["فولكس واجن", "Volkswagen"], ["لاند روفر", "Land Rover"], ["ام جي", "MG"], ["MAZDA", "Mazda"]] as const) {
      expect(canonicalManufacturer(alias), alias).toBe(canonical);
    }
    expect(canonicalManufacturer("Unknownbrand")).toBeNull();
    expect(canonicalManufacturer("مازدا صالون")).toBeNull(); // only a whole-value alias canonicalizes
    expect(matchManufacturerAt(["x", "لاند", "روفر", "y"], 1)).toEqual({ canonical: "Land Rover", tokenCount: 2 });
    expect(MANUFACTURER_REGISTRY.length).toBeGreaterThan(15);
    for (const m of MANUFACTURER_REGISTRY) expect(m.aliases.length).toBeGreaterThan(0);
  });

  it("body-style aliases produce a SUGGESTION only, mapped to BARQ's existing types; unsupported styles suggest nothing", () => {
    expect(suggestVehicleTypeFromText("صالون")).toBe("SEDAN");
    expect(suggestVehicleTypeFromText("سيدان")).toBe("SEDAN");
    expect(suggestVehicleTypeFromText("saloon")).toBe("SEDAN");
    expect(suggestVehicleTypeFromText("دفع رباعي")).toBe("FOUR_BY_FOUR");
    expect(suggestVehicleTypeFromText("رباعي")).toBe("SUV");
    expect(suggestVehicleTypeFromText("SUV")).toBe("SUV");
    expect(suggestVehicleTypeFromText("فان")).toBe("VAN");
    expect(suggestVehicleTypeFromText("حافلة")).toBe("MINIBUS");
    expect(suggestVehicleTypeFromText("حافلة صغيرة")).toBe("MINIBUS");
    for (const none of ["هاتشباك", "hatchback", "كوبيه", "coupe", "بيك أب", "pickup", "شاحنة", "truck", "استيشن", "Hilux"]) expect(suggestVehicleTypeFromText(none), none).toBeNull();
    for (const b of BODY_STYLE_REGISTRY) if (b.vehicleType) expect(VEHICLE_TYPE_CODES).toContain(b.vehicleType);
    expect(suggestTypeFromBodyStyles(["SEDAN", "FOUR_BY_FOUR"])).toBe("FOUR_BY_FOUR"); // most specific wins
    expect(suggestTypeFromBodyStyles([])).toBeNull();
  });
});

describe("1–3, 7–12. compound-description decomposition", () => {
  it("1. Arabic manufacturer + saloon + NUMERIC model → canonical make, numeric model, SEDAN suggestion", () => {
    const r = splitVehicleDescription("مازدا صالون 6");
    expect(r).toEqual({ ok: true, split: { make: "Mazda", model: "6", modelReason: null, bodyStyles: ["SEDAN"], vehicleType: "SEDAN" } });
  });

  it("2. Arabic manufacturer + SUV + MULTIWORD model stays intact", () => {
    const r = splitVehicleDescription("نيسان دفع رباعي باترول سوبر سفاري");
    expect(r).toMatchObject({ ok: true, split: { make: "Nissan", model: "باترول سوبر سفاري", bodyStyles: ["FOUR_BY_FOUR"], vehicleType: "FOUR_BY_FOUR" } });
  });

  it("3. English and bilingual descriptions decompose the same way", () => {
    expect(splitVehicleDescription("Mazda Sedan 6")).toMatchObject({ ok: true, split: { make: "Mazda", model: "6", vehicleType: "SEDAN" } });
    expect(splitVehicleDescription("Toyota / تويوتا Station Land Cruiser")).toMatchObject({ ok: true, split: { make: "Toyota", model: "Land Cruiser", bodyStyles: ["STATION_WAGON"], vehicleType: null } });
  });

  it("7. a numeric model (3 / 6 / 300 / 500) is never mistaken for a model year; 8. a four-digit year is never a model", () => {
    for (const m of ["3", "6", "300", "500"]) expect(splitVehicleDescription(`مازدا صالون ${m}`)).toMatchObject({ ok: true, split: { model: m } });
    expect(splitVehicleDescription("مازدا صالون 2019")).toMatchObject({ ok: true, split: { model: null, modelReason: "NONE_LEFT" } });
    expect(splitVehicleDescription("مازدا صالون 6 2019")).toMatchObject({ ok: true, split: { model: "6" } });
    expect(isYearLike("2019")).toBe(true);
    expect(isYearLike("300")).toBe(false);
    expect(isYearLike("٢٠١٩")).toBe(true);
  });

  it("the manufacturer is recognized at a token boundary ANYWHERE (body style first is common), never inside a word", () => {
    expect(splitVehicleDescription("صالون مازدا 6")).toMatchObject({ ok: true, split: { make: "Mazda", model: "6", vehicleType: "SEDAN" } });
    expect(splitVehicleDescription("Kiamotors Sedan X")).toEqual({ ok: false, reason: "UNKNOWN_MANUFACTURER" });
  });

  it("11. an unknown manufacturer stays unresolved (nothing split); 12. two different manufacturers are ambiguous (nothing split)", () => {
    expect(splitVehicleDescription("Unknownbrand صالون 6")).toEqual({ ok: false, reason: "UNKNOWN_MANUFACTURER" });
    expect(splitVehicleDescription("مازدا تويوتا صالون 6")).toEqual({ ok: false, reason: "AMBIGUOUS_MANUFACTURER" });
    expect(splitVehicleDescription("   ")).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("an unbounded remainder gives a make but NO model (never a guessed model name)", () => {
    const r = splitVehicleDescription("مازدا صالون one two three four five six");
    expect(r).toMatchObject({ ok: true, split: { make: "Mazda", model: null, modelReason: "UNBOUNDED" } });
  });
});

describe("9–10, 13–16. the shared builder: precedence, confidence, type, privacy", () => {
  it("9. an explicit make / model under its own label wins; the derivation fills only unresolved fields", () => {
    const r = native(["الماركة: مازدا", "الطراز: 6", "نوع المركبة: مازدا صالون 6"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Mazda", confidence: "HIGH" });
    expect(r.fields.model).toMatchObject({ normalizedValue: "6", confidence: "HIGH" });
    expect(r.fields.model.warnings).not.toContain("HEURISTIC_SPLIT");
  });

  it("10. explicit vs derived disagreement → CONFLICT with both values, nothing chosen, typed column empty", () => {
    const r = native(["الماركة: Toyota", "نوع المركبة: مازدا صالون 6"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT", "EXPLICIT_VS_DERIVED"], alternatives: ["Toyota", "Mazda"] });
    expect(prefill(r).alternatives.make).toEqual(["Toyota", "Mazda"]);
    expect(prefill(r).values.make).toBeNull();
  });

  it("15. derived values are always LOW confidence + HEURISTIC_SPLIT (the review marks them needsReview); the result is never EXTRACTED on their strength", () => {
    const r = native(["نوع المركبة: مازدا صالون 6", "رقم اللوحة: T 99001", "عدد الركاب: 5", "رقم الهيكل: TESTV1N0000000001", "تاريخ الانتهاء: 31/05/2027", "الموديل: 2019"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Mazda", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"], rawValue: "مازدا صالون 6" });
    expect(r.fields.model).toMatchObject({ normalizedValue: "6", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] });
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
    expect(prefill(r).warnings.make).toContain("HEURISTIC_SPLIT");
  });

  it("16. the original compound description is retained privately, whole", () => {
    const r = native(["نوع المركبة: " + PF_MAZDA_SALOON + " 6"]);
    expect(r.fields.vehicleDescription).toMatchObject({ normalizedValue: "مازدا صالون 6", confidence: "HIGH" });
    expect(prefill(r).documentDescription).toBe("مازدا صالون 6");
  });

  it("13. the body style only SUGGESTS a type: no type key exists on the extraction and the suggestion is computed, never stored as a value", () => {
    const r = native(["نوع المركبة: مازدا صالون 6"]);
    expect(Object.keys(r.fields)).not.toContain("vehicleType");
    expect(suggestVehicleTypeFromText(String(r.fields.vehicleDescription.normalizedValue))).toBe("SEDAN");
  });

  it("14. native PDF text and OCR candidates with equivalent synthetic content → the SAME normalized suggestions (make, model, year, description, type)", () => {
    const LINES = ["نوع المركبة: " + PF_MAZDA_SALOON + " 6", "الـمـوديل: 2019", "اللون: أبيض", "عدد الركاب: 5"];
    const CANDIDATES: RegistrationCandidates = { vehicleDescription: one("مازدا صالون 6"), model: one("2019"), color: one("أبيض"), licensedPassengerCapacity: one("5") };
    const a = prefill(native(LINES));
    const b = prefill(ocr(CANDIDATES));
    expect(a.values).toEqual(b.values);
    expect(a.values).toMatchObject({ make: "Mazda", model: "6", modelYear: 2019, color: "أبيض", licensedPassengerCapacity: 5 });
    expect(a.documentDescription).toBe(b.documentDescription);
    expect(suggestVehicleTypeFromText(a.documentDescription!)).toBe(suggestVehicleTypeFromText(b.documentDescription!));
    expect(suggestVehicleTypeFromText(a.documentDescription!)).toBe("SEDAN");
  });

  it("capacity and PII invariants are untouched by the decomposition", () => {
    const r = native(["نوع المركبة: مازدا صالون 6", "عدد الركاب: 5", "المالك: فلان الفلاني", "الرقم المدني: 11112222"]);
    expect(r.fields.registeredSeats.normalizedValue).toBeNull();
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/فلان الفلاني|11112222/);
  });

  it("17. no outbound request happened during deterministic parsing", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
