import { describe, it, expect, vi } from "vitest";
import { parseOmanVehicleRegistration, buildRegistrationExtraction, routeRegistrationCandidates } from "./parse-registration";
import { splitVehicleDescription, isYearLike } from "./vehicle-description";
import { REGISTRATION_LABELS, REGISTRATION_FIELD_GUIDANCE } from "./labels";
import { REGISTRATION_FIELD_KEYS, type RegistrationCandidates } from "./types";
import { serializePersistedFields, persistedFieldsSchema, extractionTypedColumns } from "./record";
import { mapExtractedByField } from "@/lib/vehicles/registration-review/extracted-mapping";
import { CONFIRMATION_FIELDS } from "@/lib/vehicles/registration-review/field-model";
import { suggestVehicleType } from "@/lib/vehicles/onboarding/vehicle-type-suggestion";

// Oman field-mapping contract (2026-10-09). Every value is SYNTHETIC and fictional: invented brand /
// model names, test plates and VINs. No real registration, owner, plate or document appears here.
// No network: the deterministic layer is exercised directly for BOTH tiers (native text and OCR
// candidates) and a fetch spy proves nothing leaves the process.

const NOW = new Date("2027-01-01T00:00:00.000Z");
const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

const one = (text: string) => [{ text }];
const native = (lines: string[]) => parseOmanVehicleRegistration(lines.join("\n"), NOW);
const ocr = (c: RegistrationCandidates) => buildRegistrationExtraction(c, { source: "OCR", now: NOW });

/** The confirmation keys a result would prefill (through the same mapping the review page uses). */
const prefill = (r: ReturnType<typeof native>) => mapExtractedByField(serializePersistedFields(r));

describe("1–3. labels: Arabic, English and bilingual cards map to the SAME fields", () => {
  const AR = ["رقم اللوحة: T 99001", "الماركة: Toyota", "نوع المركبة: Toyota استيشن Modelname", "الموديل: 2020", "اللون: أبيض", "عدد الركاب: 7", "رقم الهيكل: TESTV1N0000000001", "تاريخ الانتهاء: 31/05/2027", "الاستخدام: خصوصي"];
  const EN = ["Plate Number: T 99001", "Make: Toyota", "Vehicle Type: Toyota Station Modelname", "Model: 2020", "Colour: White", "Number of Passengers: 7", "Chassis Number: TESTV1N0000000001", "Expiry Date: 31/05/2027", "Usage: Private"];
  const BI = ["رقم اللوحة / Plate Number: T 99001", "الماركة / Make: Toyota", "نوع المركبة / Vehicle Type: Toyota Station Modelname", "الموديل / Model: 2020", "عدد الركاب / Passengers: 7", "رقم الهيكل / Chassis Number: TESTV1N0000000001", "تاريخ الانتهاء / Expiry Date: 31/05/2027"];

  it.each([["Arabic", AR], ["English", EN], ["bilingual", BI]])("%s labels → make, year, description, passengers, VIN, expiry land on the right fields", (_l, lines) => {
    const r = native(lines);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Toyota", confidence: "HIGH" }); // printed as its own value
    expect(r.fields.manufactureYear.normalizedValue).toBe(2020); // the year under الموديل / Model
    expect(r.fields.model.normalizedValue).toBe("Modelname"); // derived from the description (no model name printed)
    expect(r.fields.model.confidence).toBe("LOW");
    expect(r.fields.model.warnings).toContain("HEURISTIC_SPLIT");
    expect(r.fields.vehicleDescription.normalizedValue).toMatch(/^Toyota /);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.registeredSeats.normalizedValue).toBeNull();
    expect(r.fields.vin.normalizedValue).toBe("TESTV1N0000000001");
    expect(r.fields.licenseExpiry.normalizedValue).toBe("2027-05-31");
    expect(r.warnings).toContain("MODEL_LABEL_HELD_YEAR");
  });

  it("the usage field is mapped only when its own label is printed (Arabic / English)", () => {
    expect(native(AR).fields.usageClassification.normalizedValue).toBe("خصوصي");
    expect(native(EN).fields.usageClassification.normalizedValue).toBe("Private");
  });
});

describe("4. a compound description is never the manufacturer wholesale", () => {
  it("the whole description is kept PRIVATELY and only a recognized brand is split off — LOW + HEURISTIC_SPLIT, flagged for review", () => {
    const r = native(["نوع المركبة: Brandname استيشن Modelname", "عدد الركاب: 7"]);
    expect(r.fields.vehicleDescription).toMatchObject({ normalizedValue: "Brandname استيشن Modelname", confidence: "HIGH" });
    // "Brandname" is NOT in the manufacturer dictionary → nothing is split: make and model stay unresolved.
    expect(r.fields.makeDescription.normalizedValue).toBeNull();
    expect(r.fields.model.normalizedValue).toBeNull();
    expect(r.warnings).toContain("DESCRIPTION_NOT_SPLIT");
  });

  it("with a recognized brand the split is conservative: brand → make, body word removed, remainder → model, all LOW", () => {
    const r = native(["نوع المركبة: Toyota Station Modelname", "عدد الركاب: 7"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Toyota", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"], rawValue: "Toyota Station Modelname" });
    expect(r.fields.model).toMatchObject({ normalizedValue: "Modelname", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] });
    expect(r.overallStatus).toBe("NEEDS_REVIEW"); // a derived value can never make the result EXTRACTED
    const p = prefill(r);
    expect(p.values.make).toBe("Toyota");
    expect(p.values.model).toBe("Modelname");
    expect(p.documentDescription).toBe("Toyota Station Modelname");
    expect(p.warnings.make).toContain("HEURISTIC_SPLIT");
  });

  it("an Arabic-spelled brand is recognized too and emitted as the CANONICAL manufacturer; the model keeps the document's spelling", () => {
    const r = native(["نوع المركبة: تويوتا استيشن Modelname"]);
    expect(r.fields.makeDescription.normalizedValue).toBe("Toyota");
    expect(r.fields.model.normalizedValue).toBe("Modelname");
  });

  it("a description that is ONLY a brand + body word yields a make but NO model (nothing invented)", () => {
    const r = native(["نوع المركبة: Toyota Station"]);
    expect(r.fields.makeDescription.normalizedValue).toBe("Toyota");
    expect(r.fields.model.normalizedValue).toBeNull();
    expect(r.warnings).toContain("DESCRIPTION_HAS_NO_MODEL");
  });

  it("splitVehicleDescription is pure and conservative: unknown brand → not split; body words are stripped; multi-word brands work", () => {
    expect(splitVehicleDescription("Unknownbrand Station X")).toEqual({ ok: false, reason: "UNKNOWN_MANUFACTURER" });
    expect(splitVehicleDescription("Land Rover Station Modelname")).toMatchObject({ ok: true, split: { make: "Land Rover", model: "Modelname", bodyStyles: ["STATION_WAGON"], vehicleType: null } });
    expect(splitVehicleDescription("Nissan Pickup Double Cab Modelname")).toMatchObject({ ok: true, split: { make: "Nissan", model: "Modelname", bodyStyles: ["PICKUP", "PICKUP"] } });
    expect(splitVehicleDescription("")).toEqual({ ok: false, reason: "EMPTY" });
  });
});

describe("5. explicit make + explicit model win over the description", () => {
  it("printed make and model name are used as-is (HIGH) when the description agrees; the description stays a private reference", () => {
    const r = native(["الماركة: Toyota", "الطراز: Modelname", "نوع المركبة: Toyota Station Modelname", "الموديل: 2019"]);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Toyota", confidence: "HIGH" });
    expect(r.fields.model).toMatchObject({ normalizedValue: "Modelname", confidence: "HIGH" });
    expect(r.fields.model.warnings).not.toContain("HEURISTIC_SPLIT");
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.vehicleDescription.normalizedValue).toBe("Toyota Station Modelname");
  });

  it("when the printed model and the description DISAGREE the field becomes a CONFLICT for the provider — neither value is chosen", () => {
    const r = native(["الماركة: Toyota", "الطراز: Modelname", "نوع المركبة: Toyota Station Modelname GXR"]);
    expect(r.fields.model).toMatchObject({ normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT", "EXPLICIT_VS_DERIVED"], alternatives: ["Modelname", "Modelname GXR"] });
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Toyota", confidence: "HIGH" }); // make agrees → untouched
  });
});

describe("6. model-year terminology collision: a year is NEVER the commercial model", () => {
  it("native text: 'الموديل: 2019' → manufactureYear 2019, model unresolved; 'سنة الموديل' still works; 'model' word-bounded", () => {
    const r = native(["الموديل: 2019"]);
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.model.normalizedValue).toBeNull();
    expect(native(["سنة الموديل: 2018"]).fields.manufactureYear.normalizedValue).toBe(2018);
    expect(native(["Models: 2017"]).fields.manufactureYear.normalizedValue).toBeNull(); // "models" is not the label "model"
  });

  it("OCR candidates: a year reported under model is routed to manufactureYear by the SAME shared rule", () => {
    const r = ocr({ model: one("2019"), makeDescription: one("Toyota") });
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.model.normalizedValue).toBeNull();
    expect(r.warnings).toContain("MODEL_LABEL_HELD_YEAR");
  });

  it("a year under model AND an explicit year: the explicit one stays, the duplicate is merged, no conflict is invented for the same year", () => {
    const r = ocr({ model: one("2019"), manufactureYear: one("2019") });
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.manufactureYear.warnings).not.toContain("CONFLICT");
    const two = ocr({ model: one("2019"), manufactureYear: one("2020") });
    expect(two.fields.manufactureYear).toMatchObject({ normalizedValue: null, warnings: ["CONFLICT"], alternatives: [2020, 2019] }); // genuinely different → the provider decides
  });

  it("a year reported as the MAKE is refused (never stored), with a document-level code", () => {
    const r = ocr({ makeDescription: one("2019") });
    expect(r.fields.makeDescription.normalizedValue).toBeNull();
    expect(r.warnings).toContain("MAKE_LABEL_HELD_YEAR");
    expect(isYearLike("2019")).toBe(true);
    expect(isYearLike("٢٠١٩")).toBe(true);
    expect(isYearLike("Modelname 2019")).toBe(false);
  });

  it("routeRegistrationCandidates leaves every other field untouched", () => {
    const input: RegistrationCandidates = { plateNumber: one("T 1"), color: one("White"), model: one("Modelname") };
    expect(routeRegistrationCandidates(input)).toEqual({ candidates: input, warnings: [] });
  });
});

describe("7. no commercial model available", () => {
  it("make + year only → model stays unresolved (MISSING); nothing is invented from the make or the year", () => {
    const r = native(["الماركة: Toyota", "الموديل: 2019", "عدد الركاب: 5"]);
    expect(r.fields.model).toMatchObject({ normalizedValue: null, warnings: ["MISSING"] });
    expect(prefill(r).values.model).toBeNull();
  });
});

describe("8. body style is a SUGGESTION for the vehicle type — never a confirmed value", () => {
  it("the description's body word yields a suggestion code; it is not a field on the result and the confirmation model has no type key", () => {
    const r = native(["نوع المركبة: Toyota Station Modelname"]);
    expect(suggestVehicleType([r.fields.vehicleDescription.normalizedValue, r.fields.makeDescription.normalizedValue].join(" "))).toBeNull(); // "station" alone is no canonical type
    expect(suggestVehicleType("Toyota Pickup 4x4 Modelname")).toBe("FOUR_BY_FOUR");
    expect(suggestVehicleType("Brandname حافلة صغيرة")).toBe("MINIBUS");
    expect(REGISTRATION_FIELD_KEYS).not.toContain("vehicleType" as never);
    expect(Object.keys(CONFIRMATION_FIELDS)).not.toContain("vehicleType");
  });
});

describe("9–11. capacity fields stay distinct", () => {
  it("passenger count only → licensed 7, registered seats UNRESOLVED (not 7, not 8), no failure claimed", () => {
    const r = native(["عدد الركاب: 7", "رقم اللوحة: T 1"]);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.registeredSeats).toMatchObject({ normalizedValue: null, warnings: ["MISSING"] });
    expect(r.overallStatus).not.toBe("FAILED");
    expect(prefill(r).values.registeredSeats).toBeNull();
    expect(prefill(r).values.bookablePassengerCapacity).toBeUndefined(); // never suggested at all
  });

  it("passenger count plus an explicit seats label → both, separately", () => {
    const r = native(["عدد الركاب: 7", "عدد المقاعد: 8"]);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.registeredSeats.normalizedValue).toBe(8);
    expect(prefill(r).values.registeredSeats).toBe(8);
    const en = native(["Number of Passengers: 7", "Seating Capacity: 8"]);
    expect(en.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(en.fields.registeredSeats.normalizedValue).toBe(8);
  });

  it("OCR: the same separation — a passengers candidate never becomes seats", () => {
    const r = ocr({ licensedPassengerCapacity: one("7") });
    expect(r.fields.registeredSeats.normalizedValue).toBeNull();
    expect(extractionTypedColumns(r).extractedLicensedPassengerCapacity).toBe(7);
  });
});

describe("12–13. usage", () => {
  it("present (Arabic / English / bilingual) → mapped; absent → unresolved; never inferred from the plate type", () => {
    expect(native(["نوع الاستخدام: خصوصي"]).fields.usageClassification.normalizedValue).toBe("خصوصي");
    expect(native(["Usage: Private"]).fields.usageClassification.normalizedValue).toBe("Private");
    expect(native(["الاستخدام / Usage: خصوصي"]).fields.usageClassification.normalizedValue).toBe("خصوصي");
    const plateOnly = native(["نوع اللوحة: خصوصي", "رقم اللوحة: T 1"]);
    expect(plateOnly.fields.plateType.normalizedValue).toBe("خصوصي");
    expect(plateOnly.fields.usageClassification).toMatchObject({ normalizedValue: null, warnings: ["MISSING"] });
  });

  it("usage printed differently on the two sides → CONFLICT, unresolved, both kept", () => {
    const r = ocr({ usageClassification: [{ text: "خصوصي" }, { text: "تجاري" }] });
    expect(r.fields.usageClassification).toMatchObject({ normalizedValue: null, warnings: ["CONFLICT"], alternatives: ["خصوصي", "تجاري"] });
  });
});

describe("14. conflicts between front and back stay unresolved", () => {
  it("different years on the two sides: nothing chosen, both offered; the typed column stays empty", () => {
    const r = ocr({ manufactureYear: [{ text: "2019" }, { text: "2020" }], makeDescription: one("Toyota") });
    expect(r.fields.manufactureYear).toMatchObject({ normalizedValue: null, warnings: ["CONFLICT"], alternatives: [2019, 2020] });
    expect(extractionTypedColumns(r).extractedManufactureYear).toBeNull();
    expect(prefill(r).alternatives.modelYear).toEqual([2019, 2020]);
  });
});

describe("15. the SAME semantic result from native PDF text and from two-image OCR", () => {
  const LINES = ["رقم اللوحة: T 99001", "نوع المركبة: Toyota Station Modelname", "الموديل: 2020", "اللون: أبيض", "عدد الركاب: 7", "رقم الهيكل: TESTV1N0000000001", "تاريخ الانتهاء: 31/05/2027", "الاستخدام: خصوصي"];
  const CANDIDATES: RegistrationCandidates = {
    plateNumber: one("T 99001"), vehicleDescription: one("Toyota Station Modelname"), model: one("2020"), color: one("أبيض"),
    licensedPassengerCapacity: one("7"), vin: one("TESTV1N0000000001"), licenseExpiry: one("31/05/2027"), usageClassification: one("خصوصي"),
  };

  it("both tiers produce identical normalized values for every confirmation field, through the one builder", () => {
    const a = prefill(native(LINES));
    const b = prefill(ocr(CANDIDATES));
    expect(b.values).toEqual(a.values);
    expect(a.values).toMatchObject({ make: "Toyota", model: "Modelname", modelYear: 2020, color: "أبيض", licensedPassengerCapacity: 7, registeredSeats: null, plateNumber: "T 99001", vin: "TESTV1N0000000001", licenseExpiry: "2027-05-31", usageClassification: "خصوصي" });
    expect(a.documentDescription).toBe(b.documentDescription);
    // The only difference is confidence (OCR is capped so every value is reviewed) — never the meaning.
    expect(Object.values(ocr(CANDIDATES).fields).some((f) => f.confidence === "HIGH")).toBe(false);
  });

  it("neither tier can bypass normalization: a persisted blob with a year as the model is rejected by the strict reader only if malformed, and the builder never writes one", () => {
    for (const r of [native(LINES), ocr(CANDIDATES)]) {
      const stored = persistedFieldsSchema.parse(serializePersistedFields(r));
      expect(isYearLike(String(stored.model!.normalizedValue ?? ""))).toBe(false);
      expect(isYearLike(String(stored.makeDescription!.normalizedValue ?? ""))).toBe(false);
    }
  });

  it("owner / civil number / address / insurance are discarded on both tiers (no key exists for them)", () => {
    const r = native([...LINES, "المالك: فلان الفلاني", "الرقم المدني: 11112222", "العنوان: مكان ما", "شركة التأمين: شركة كذا"]);
    const json = JSON.stringify(r);
    for (const leak of ["فلان الفلاني", "11112222", "مكان ما", "شركة كذا"]) expect(json).not.toContain(leak);
    expect(r.warnings).toContain("DISCARDED_PII_LABELS_PRESENT");
    expect(Object.keys(ocr({ ...CANDIDATES, ownerName: one("x") } as RegistrationCandidates).fields)).not.toContain("ownerName");
  });
});

describe("shared contract: the OCR tool is told the same meanings the parser applies", () => {
  it("every field has one guidance sentence, and the guidance encodes the Oman rules", () => {
    for (const k of REGISTRATION_FIELD_KEYS) expect(REGISTRATION_FIELD_GUIDANCE[k].length).toBeGreaterThan(20);
    expect(REGISTRATION_FIELD_GUIDANCE.model).toMatch(/NEVER a year/);
    expect(REGISTRATION_FIELD_GUIDANCE.makeDescription).toMatch(/Do NOT put the full vehicle description/);
    expect(REGISTRATION_FIELD_GUIDANCE.vehicleDescription).toMatch(/do not split/);
    expect(REGISTRATION_FIELD_GUIDANCE.registeredSeats).toMatch(/Never compute/);
    expect(REGISTRATION_FIELD_GUIDANCE.usageClassification).toMatch(/Never derived from the plate type/);
    expect(REGISTRATION_LABELS.makeDescription).not.toContain("نوع المركبة");
    expect(REGISTRATION_LABELS.vehicleDescription).toContain("نوع المركبة");
    expect(REGISTRATION_LABELS.licensedPassengerCapacity).not.toContain("seating capacity");
  });
});

describe("24. nothing left the process", () => {
  it("no outbound request was made by any test in this file", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
