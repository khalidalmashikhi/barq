import { describe, it, expect } from "vitest";
import { buildRegistrationExtraction, parseOmanVehicleRegistration, isNativeTextUsable } from "./parse-registration";
import { persistedFieldsSchema, serializePersistedFields, extractionTypedColumns } from "./record";
import { REGISTRATION_FIELD_KEYS, type RegistrationCandidates } from "./types";

// What the deterministic rules make of text an OCR engine reports. The engine only contributes
// detected text per allowlisted field; these rules decide the value, its confidence and whether
// the provider must review it. All values are synthetic.

const NOW = new Date("2026-10-05T00:00:00Z");
const ocr = (candidates: RegistrationCandidates) => buildRegistrationExtraction(candidates, { source: "OCR", now: NOW });
const one = (text: string, unclear = false) => [{ text, unclear }];

const ARABIC_CARD: RegistrationCandidates = {
  plateNumber: one("٩٩٠٠١ ت"),
  makeDescription: one("تويوتا"),
  model: one("لاند كروزر"),
  color: one("أبيض"),
  manufactureYear: one("٢٠٢٠"),
  licensedPassengerCapacity: one("٧"),
  vin: one("TESTV1N0000000001"),
  licenseExpiry: one("٣١/٠٥/٢٠٢٧"),
  usageClassification: one("خصوصي"),
};
const ENGLISH_CARD: RegistrationCandidates = {
  plateNumber: one("T 99001"),
  makeDescription: one("Toyota"),
  model: one("Testcruiser"),
  color: one("White"),
  manufactureYear: one("2020"),
  licensedPassengerCapacity: one("7"),
  vin: one("testv1n0000000001"),
  licenseExpiry: one("2027-05-31"),
};

describe("OCR candidates → validated result", () => {
  it("ARABIC-ONLY values: Arabic-Indic digits are normalized, Arabic text is kept as printed", () => {
    const r = ocr(ARABIC_CARD);
    expect(r.source).toBe("OCR");
    expect(r.fields.manufactureYear).toMatchObject({ rawValue: "٢٠٢٠", normalizedValue: 2020 });
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.licenseExpiry.normalizedValue).toBe("2027-05-31");
    expect(r.fields.makeDescription.normalizedValue).toBe("تويوتا");
    expect(r.fields.color.normalizedValue).toBe("أبيض");
    expect(r.fields.plateNumber.normalizedValue).toBe("99001 ت");
    expect(r.fields.vin.normalizedValue).toBe("TESTV1N0000000001");
  });

  it("ENGLISH-ONLY values: the same rules; the VIN is upper-cased", () => {
    const r = ocr(ENGLISH_CARD);
    expect(r.fields.manufactureYear.normalizedValue).toBe(2020);
    expect(r.fields.vin.normalizedValue).toBe("TESTV1N0000000001");
    expect(r.fields.licenseExpiry.normalizedValue).toBe("2027-05-31");
    expect(r.fields.plateNumber.normalizedValue).toBe("T 99001");
  });

  it("BILINGUAL document: the same value reported in both scripts agrees; different scripts for a TEXT field are a conflict to review", () => {
    const r = ocr({
      manufactureYear: [{ text: "2020" }, { text: "٢٠٢٠" }], // same number in two scripts
      licenseExpiry: [{ text: "31/05/2027" }, { text: "٢٠٢٧-٠٥-٣١" }], // same date, two notations
      makeDescription: [{ text: "Toyota" }, { text: "تويوتا" }], // genuinely different strings
    });
    expect(r.fields.manufactureYear).toMatchObject({ normalizedValue: 2020 });
    expect(r.fields.manufactureYear.warnings).not.toContain("CONFLICT");
    expect(r.fields.licenseExpiry.normalizedValue).toBe("2027-05-31");
    expect(r.fields.licenseExpiry.warnings).not.toContain("CONFLICT");
    expect(r.fields.makeDescription.warnings).toContain("CONFLICT");
    expect(r.fields.makeDescription.confidence).toBe("LOW");
  });

  it("an OCR value is NEVER high confidence, and an OCR result is NEVER 'EXTRACTED' — it always needs review", () => {
    for (const card of [ARABIC_CARD, ENGLISH_CARD]) {
      const r = ocr(card);
      expect(r.overallStatus).toBe("NEEDS_REVIEW");
      for (const key of REGISTRATION_FIELD_KEYS) expect(r.fields[key].confidence, key).not.toBe("HIGH");
      for (const key of Object.keys(card) as (keyof typeof card)[]) expect(r.fields[key].confidence, key).toBe("MEDIUM");
    }
    // The very same text from a native PDF text layer WOULD be high confidence — the cap is about the source.
    const native = parseOmanVehicleRegistration(["Plate Number: T 99001", "Vehicle Make: Toyota", "Model: Testcruiser", "Model Year: 2020", "Number of Passengers: 7", "Chassis Number: TESTV1N0000000001", "Expiry Date: 31/05/2027"].join("\n"), NOW);
    expect(native.overallStatus).toBe("EXTRACTED");
    expect(native.fields.manufactureYear.confidence).toBe("HIGH");
  });

  it("POOR-QUALITY image: a value the engine flagged unclear is LOW confidence with OCR_UNCLEAR", () => {
    const r = ocr({ ...ENGLISH_CARD, plateNumber: one("T 9900I", true), vin: one("TESTV1N000000000l", true) });
    expect(r.fields.plateNumber).toMatchObject({ confidence: "LOW", normalizedValue: "T 9900I" });
    expect(r.fields.plateNumber.warnings).toContain("OCR_UNCLEAR");
    expect(r.fields.vin.confidence).toBe("LOW");
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
  });

  it("MISSING field: nothing is inferred — it stays unresolved (null) with MISSING", () => {
    const { color: _color, licensedPassengerCapacity: _seats, ...partial } = ENGLISH_CARD;
    void _color; void _seats;
    const r = ocr(partial);
    for (const key of ["color", "licensedPassengerCapacity", "engineNumber", "plateType"] as const) {
      expect(r.fields[key]).toEqual({ rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] });
    }
    // In particular the seat count is NOT guessed from anything else on the card.
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBeNull();
  });

  it("CONFLICTING values for one field → UNRESOLVED (null) + LOW + CONFLICT, both values kept — nothing is chosen for the provider", () => {
    const r = ocr({ ...ENGLISH_CARD, manufactureYear: [{ text: "2019" }, { text: "2020" }], licensedPassengerCapacity: [{ text: "7" }, { text: "8" }] });
    expect(r.fields.manufactureYear).toMatchObject({ normalizedValue: null, confidence: "LOW", alternatives: [2019, 2020] });
    expect(r.fields.manufactureYear.warnings).toContain("CONFLICT");
    expect(r.fields.licensedPassengerCapacity).toMatchObject({ normalizedValue: null, alternatives: [7, 8] });
    expect(r.fields.licensedPassengerCapacity.warnings).toContain("CONFLICT");
  });

  it.each([
    ["a year far in the future", "manufactureYear", "2099"],
    ["a year before any plausible vehicle", "manufactureYear", "1890"],
    ["a non-numeric year", "manufactureYear", "twenty-twenty"],
    ["zero seats", "licensedPassengerCapacity", "0"],
    ["negative seats", "licensedPassengerCapacity", "-4"],
    ["a decimal seat count", "licensedPassengerCapacity", "7.5"],
    ["seats with trailing text", "licensedPassengerCapacity", "7 passengers and luggage"],
    ["an impossible date", "licenseExpiry", "31/02/2027"],
    ["a two-digit-year date (never guessed)", "licenseExpiry", "31/05/27"],
  ] as const)("INVALID %s → unresolved (null), never coerced", (_label, key, text) => {
    const r = ocr({ ...ENGLISH_CARD, [key]: one(text) });
    expect(r.fields[key].normalizedValue).toBeNull();
    expect(r.fields[key].confidence).toBe("LOW");
    expect(r.fields[key].warnings).toContain("UNPARSEABLE");
    expect(r.fields[key].rawValue).toBe(text); // what was detected is kept for the provider to see
  });

  it("a VIN with an illegal character or the wrong length is kept but flagged", () => {
    expect(ocr({ vin: one("TESTV1N00000O0001") }).fields.vin.warnings).toContain("VIN_CHARSET"); // letter O
    expect(ocr({ vin: one("TESTV1N0001") }).fields.vin.warnings).toContain("VIN_LENGTH");
  });

  it("NOTHING readable (not a registration document) → FAILED, with no field value", () => {
    const r = ocr({});
    expect(r.overallStatus).toBe("FAILED");
    expect(r.warnings).toContain("NO_SUPPORTED_FIELDS");
    for (const key of REGISTRATION_FIELD_KEYS) expect(r.fields[key].normalizedValue).toBeNull();
  });

  it("the result has ONLY the allowlisted fields and persists through the strict schema (no room for owner / civil-number data)", () => {
    const r = ocr({ ...ENGLISH_CARD, ...({ ownerName: one("Synthetic Person"), civilNumber: one("12345678") } as unknown as RegistrationCandidates) });
    expect(Object.keys(r.fields).sort()).toEqual([...REGISTRATION_FIELD_KEYS].sort());
    const stored = serializePersistedFields(r);
    expect(persistedFieldsSchema.safeParse(stored).success).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/Synthetic Person|12345678|ownerName|civilNumber/);
  });

  it("customer/bookable capacity and registered seats are NOT extraction fields at all — OCR cannot fill them", () => {
    expect(REGISTRATION_FIELD_KEYS).not.toContain("bookablePassengerCapacity" as never);
    expect(REGISTRATION_FIELD_KEYS).not.toContain("registeredSeats" as never);
  });
});

describe("a field printed DIFFERENTLY on two sides / pages of the set", () => {
  it("is NOT chosen silently: the value is null, confidence LOW, CONFLICT flagged, every distinct value kept in detection order", () => {
    const r = ocr({ ...ENGLISH_CARD, manufactureYear: [{ text: "2019" }, { text: "2020" }] });
    expect(r.fields.manufactureYear).toMatchObject({ normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives: [2019, 2020] });
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
  });

  it("the SAME value seen on both sides is agreement, not a conflict", () => {
    const r = ocr({ ...ENGLISH_CARD, manufactureYear: [{ text: "2020" }, { text: "٢٠٢٠" }] });
    expect(r.fields.manufactureYear.normalizedValue).toBe(2020);
    expect(r.fields.manufactureYear.warnings).not.toContain("CONFLICT");
    expect(r.fields.manufactureYear.alternatives).toBeUndefined();
  });

  it("alternatives are distinct and bounded", () => {
    const r = ocr({ ...ENGLISH_CARD, manufactureYear: [{ text: "2015" }, { text: "2016" }, { text: "2017" }, { text: "2018" }, { text: "2019" }, { text: "2015" }] });
    expect(r.fields.manufactureYear.alternatives).toEqual([2015, 2016, 2017, 2018]);
  });

  it("a conflicting IDENTIFIER never reaches the typed searchable columns", () => {
    const r = ocr({ ...ENGLISH_CARD, plateNumber: [{ text: "T 99001" }, { text: "T 99002" }], vin: [{ text: "TESTV1N0000000001" }, { text: "TESTV1N0000000002" }] });
    expect(extractionTypedColumns(r)).toMatchObject({ extractedPlateNumber: null, extractedVin: null });
    expect(r.fields.plateNumber.alternatives).toEqual(["T 99001", "T 99002"]);
  });

  it("the persisted (strict) shape keeps the alternatives — and only on a conflict", () => {
    const r = ocr({ ...ENGLISH_CARD, manufactureYear: [{ text: "2019" }, { text: "2020" }] });
    const stored = persistedFieldsSchema.parse(serializePersistedFields(r)) as Record<string, { alternatives?: unknown[] }>;
    expect(stored.manufactureYear!.alternatives).toEqual([2019, 2020]);
    expect(stored.makeDescription!.alternatives).toBeUndefined();
  });
});

describe("isNativeTextUsable — when the local PDF text counts as a reading", () => {
  it("usable: at least one critical field resolved from the text layer → zero external calls", () => {
    expect(isNativeTextUsable(parseOmanVehicleRegistration("رقم اللوحة: A 12345", NOW))).toBe(true);
    expect(isNativeTextUsable(parseOmanVehicleRegistration("Chassis Number: TESTV1N0000000001", NOW))).toBe(true);
  });

  it("NOT usable: a text layer with no registration content (unsupported layout, cover page) — the PDF is then offered to OCR instead of dead-ending", () => {
    expect(isNativeTextUsable(parseOmanVehicleRegistration("Ministry of Transport\nVehicle services\nPage 1 of 2", NOW))).toBe(false);
    expect(isNativeTextUsable(parseOmanVehicleRegistration("", NOW))).toBe(false);
  });
});
