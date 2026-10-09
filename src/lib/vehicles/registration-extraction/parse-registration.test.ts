import { describe, it, expect } from "vitest";
import { parseOmanVehicleRegistration } from "./parse-registration";

// Phase 3C Slice 2 — the pure parser. Every value here is FICTIONAL and bears no
// resemblance to any real registration record. `NOW` fixes the manufacture-year ceiling.
const NOW = new Date("2027-01-01T00:00:00.000Z"); // maxYear = 2028

// A synthetic, fully-populated Arabic layout incl. PII lines that MUST be discarded.
const FULL = [
  "رقم اللوحة: A 12345",
  "نوع اللوحة: خصوصي",
  "الماركة: Toyota",
  "نوع المركبة: Toyota Station Land Cruiser",
  "الطراز: Land Cruiser",
  "اللون: أبيض",
  "نوع الاستخدام: خاص",
  "سنة الصنع: 2019",
  "سعة المحرك: 4000 cc",
  "الوزن الفارغ: 2500 kg",
  "الحمولة القصوى: 3000 kg",
  "عدد المحاور: 2",
  "عدد الركاب: 7",
  "رقم الهيكل: JTEBU29J8K5012345",
  "رقم المحرك: ENG1234567",
  "تاريخ الإصدار: 01/06/2026",
  "تاريخ الانتهاء: 31/05/2027",
  "تاريخ أول تسجيل: 01/06/2019",
  // --- PII lines (must be discarded; fictional) ---
  "المالك: فلان الفلاني",
  "الجنسية: عماني",
  "الرقم المدني: 99887766",
  "شركة التأمين: شركة التأمين الوطنية",
  "رقم الوثيقة: POL-XYZ-000",
].join("\n");

describe("parseOmanVehicleRegistration — full happy path", () => {
  const r = parseOmanVehicleRegistration(FULL, NOW);

  it("extracts the allowlisted operational fields with correct normalization", () => {
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.fields.axleCount.normalizedValue).toBe(2);
    expect(r.fields.vin.normalizedValue).toBe("JTEBU29J8K5012345");
    expect(r.fields.vin.confidence).toBe("HIGH");
    expect(r.fields.licenseExpiry.normalizedValue).toBe("2027-05-31");
    expect(r.fields.engineCapacity.normalizedValue).toBe(4000);
    expect(r.fields.plateNumber.normalizedValue).toBe("A 12345");
    expect(r.fields.makeDescription.normalizedValue).toBe("Toyota");
    expect(r.overallStatus).toBe("EXTRACTED");
    expect(r.parserVersion).toBe("1.1.0");
    expect(r.fields.vehicleDescription.normalizedValue).toBe("Toyota Station Land Cruiser"); // kept whole, privately
    expect(r.fields.model.normalizedValue).toBe("Land Cruiser");
    expect(r.source).toBe("NATIVE_PDF_TEXT");
    expect(r.documentKind).toBe("OMAN_VEHICLE_REGISTRATION");
  });

  it("DISCARDS owner/insurance PII — flags presence via a code, never a value", () => {
    expect(r.warnings).toContain("DISCARDED_PII_LABELS_PRESENT");
    const json = JSON.stringify(r);
    for (const pii of ["فلان الفلاني", "عماني", "99887766", "شركة التأمين الوطنية", "POL-XYZ-000"]) {
      expect(json).not.toContain(pii);
    }
    // No owner/insurer field keys exist on the result at all.
    expect(Object.keys(r.fields)).not.toContain("ownerName");
    expect(Object.keys(r.fields)).not.toContain("policyNumber");
  });
});

describe("parseOmanVehicleRegistration — normalization + variations", () => {
  it("Arabic-Indic digits in the passenger count", () => {
    const r = parseOmanVehicleRegistration("عدد الركاب: ١٥", NOW); // ١٥
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(15);
  });

  it("tolerates bidi/zero-width noise around labels and values", () => {
    const r = parseOmanVehicleRegistration("‏عدد الركاب‎: ⁦١٣⁩", NOW);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(13);
  });

  it("reordered value-before-label still captures the value", () => {
    const r = parseOmanVehicleRegistration("A 777 رقم اللوحة", NOW);
    expect(r.fields.plateNumber.normalizedValue).toBe("A 777");
  });

  it("measure without a unit → MEDIUM + UNIT_MISSING", () => {
    const r = parseOmanVehicleRegistration("سعة المحرك: 2000", NOW);
    expect(r.fields.engineCapacity.normalizedValue).toBe(2000);
    expect(r.fields.engineCapacity.confidence).toBe("MEDIUM");
    expect(r.fields.engineCapacity.warnings).toContain("UNIT_MISSING");
  });

  it("VIN non-17 → MEDIUM/VIN_LENGTH; forbidden charset → LOW/VIN_CHARSET", () => {
    expect(parseOmanVehicleRegistration("رقم الهيكل: ABC12345", NOW).fields.vin.confidence).toBe("MEDIUM");
    expect(parseOmanVehicleRegistration("رقم الهيكل: ABC12345", NOW).fields.vin.warnings).toContain("VIN_LENGTH");
    const bad = parseOmanVehicleRegistration("رقم الهيكل: IOQ1234567890XYZAB", NOW).fields.vin;
    expect(bad.confidence).toBe("LOW");
    expect(bad.warnings).toContain("VIN_CHARSET");
  });
});

describe("parseOmanVehicleRegistration — status + duplicates + conflicts", () => {
  it("missing a critical field (VIN) → NEEDS_REVIEW with the field MISSING", () => {
    const noVin = FULL.split("\n").filter((l) => !l.startsWith("رقم الهيكل")).join("\n");
    const r = parseOmanVehicleRegistration(noVin, NOW);
    expect(r.fields.vin.normalizedValue).toBeNull();
    expect(r.fields.vin.warnings).toContain("MISSING");
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
  });

  it("duplicate label with the SAME value → DUPLICATE_LABEL, still usable", () => {
    const r = parseOmanVehicleRegistration("عدد الركاب: 7\nعدد الركاب: 7", NOW);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(r.fields.licensedPassengerCapacity.warnings).toContain("DUPLICATE_LABEL");
  });

  it("conflicting values → CONFLICT + LOW → NEEDS_REVIEW", () => {
    const r = parseOmanVehicleRegistration("عدد الركاب: 7\nعدد الركاب: 9", NOW);
    expect(r.fields.licensedPassengerCapacity.confidence).toBe("LOW");
    expect(r.fields.licensedPassengerCapacity.warnings).toContain("CONFLICT");
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
  });

  it("no recognizable field → FAILED with NO_SUPPORTED_FIELDS", () => {
    const r = parseOmanVehicleRegistration("random text with no labels\nlorem ipsum", NOW);
    expect(r.overallStatus).toBe("FAILED");
    expect(r.warnings).toContain("NO_SUPPORTED_FIELDS");
  });

  it("PII-only document → FAILED, no PII value leaks, PII presence flagged", () => {
    const r = parseOmanVehicleRegistration("المالك: فلان الفلاني\nشركة التأمين: شركة كذا", NOW);
    expect(r.overallStatus).toBe("FAILED");
    expect(r.warnings).toContain("DISCARDED_PII_LABELS_PRESENT");
    expect(JSON.stringify(r)).not.toContain("فلان الفلاني");
  });
});

describe("parseOmanVehicleRegistration — Arabic/RTL robustness (Slice-2 correction, G)", () => {
  it("English colon and full-width colon variants both parse", () => {
    expect(parseOmanVehicleRegistration("Number of Passengers: 7", NOW).fields.licensedPassengerCapacity.normalizedValue).toBe(7);
    expect(parseOmanVehicleRegistration("عدد الركاب： 7", NOW).fields.licensedPassengerCapacity.normalizedValue).toBe(7);
  });

  it("extra whitespace around label/value is tolerated", () => {
    expect(parseOmanVehicleRegistration("عدد   الركاب   :    7", NOW).fields.licensedPassengerCapacity.normalizedValue).toBe(7);
  });

  it("header/footer repetition (same label+value twice) → DUPLICATE_LABEL, not CONFLICT", () => {
    const r = parseOmanVehicleRegistration("رقم الهيكل: JTEBU29J8K5012345\nرقم الهيكل: JTEBU29J8K5012345", NOW);
    expect(r.fields.vin.normalizedValue).toBe("JTEBU29J8K5012345");
    expect(r.fields.vin.warnings).toContain("DUPLICATE_LABEL");
    expect(r.fields.vin.warnings).not.toContain("CONFLICT");
  });

  it("conflicting values across pages → CONFLICT + LOW, never silently authoritative", () => {
    const r = parseOmanVehicleRegistration("رقم الهيكل: JTEBU29J8K5012345\nرقم الهيكل: JTEBU29J8K5099999", NOW);
    expect(r.fields.vin.confidence).toBe("LOW");
    expect(r.fields.vin.warnings).toContain("CONFLICT");
    expect(r.overallStatus).toBe("NEEDS_REVIEW");
  });

  it("licensed passenger capacity is SEPARATE from registered seats: a passenger count never fills the seats field, and bookable capacity is not an extraction field at all", () => {
    const r = parseOmanVehicleRegistration("عدد الركاب: 15", NOW);
    expect(r.fields.licensedPassengerCapacity.normalizedValue).toBe(15);
    expect(r.fields.registeredSeats).toMatchObject({ normalizedValue: null, warnings: ["MISSING"] }); // never derived (no "+1 driver")
    expect((r.fields as Record<string, unknown>).bookablePassengerCapacity).toBeUndefined();
  });
});
