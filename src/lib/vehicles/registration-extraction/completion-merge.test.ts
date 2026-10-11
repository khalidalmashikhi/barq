import { describe, it, expect } from "vitest";
import { mergeCompletion, isIdentityIncomplete, candidatesFromStoredFields, FROM_COMPLETION_WARNING, COMPLETION_DIFFERS_WARNING, COMPLETION_CONFLICT_WARNING } from "./completion-merge";
import { buildRegistrationExtraction } from "./parse-registration";
import { REGISTRATION_FIELD_KEYS, type VehicleRegistrationFields } from "./types";

// Pure merge rules of the optional automatic completion (2026-10-09). Synthetic values only.

const missing = () => ({ rawValue: null, normalizedValue: null, confidence: "LOW" as const, warnings: ["MISSING"] });
function fields(over: Record<string, unknown> = {}): VehicleRegistrationFields {
  const f = Object.fromEntries(REGISTRATION_FIELD_KEYS.map((k) => [k, missing()])) as Record<string, unknown>;
  return { ...f, ...over } as unknown as VehicleRegistrationFields;
}
const val = (v: string | number, confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH", warnings: string[] = []) => ({ rawValue: String(v), normalizedValue: v, confidence, warnings });

describe("isIdentityIncomplete — the server-side completeness rule", () => {
  it("15. missing manufacturer OR commercial model → incomplete; both present → complete", () => {
    expect(isIdentityIncomplete(fields())).toBe(true);
    expect(isIdentityIncomplete(fields({ makeDescription: val("Mazda") }))).toBe(true);
    expect(isIdentityIncomplete(fields({ model: val("6") }))).toBe(true);
    expect(isIdentityIncomplete(fields({ makeDescription: val("Mazda"), model: val("6") }))).toBe(false);
  });

  it("a CONFLICT is not 'missing' (the provider picks one); provider-entered/private fields never count", () => {
    const conflict = { rawValue: "6", normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives: ["6", "6 GXR"] };
    expect(isIdentityIncomplete(fields({ makeDescription: val("Mazda"), model: conflict }))).toBe(false);
    // registered seats / plate / VIN / dates missing do not make a reading incomplete
    expect(isIdentityIncomplete(fields({ makeDescription: val("Mazda"), model: val("6"), registeredSeats: missing(), vin: missing() }))).toBe(false);
  });
});

describe("mergeCompletion — enrich, never blindly replace", () => {
  const automatic = buildRegistrationExtraction(
    { makeDescription: [{ text: "Mazda" }], model: [{ text: "6" }], color: [{ text: "Red" }], manufactureYear: [{ text: "2020" }], plateNumber: [{ text: "T 99001" }] },
    { source: "OCR" },
  ).fields;

  it("29. fills UNRESOLVED fields — as reviewable suggestions (never HIGH), flagged as completed", () => {
    const r = mergeCompletion(fields(), automatic);
    expect(r.fields.makeDescription).toMatchObject({ normalizedValue: "Mazda" });
    expect(r.fields.model).toMatchObject({ normalizedValue: "6" });
    for (const k of ["makeDescription", "model", "color"] as const) {
      expect(r.fields[k].warnings).toContain(FROM_COMPLETION_WARNING);
      expect(r.fields[k].confidence).not.toBe("HIGH");
    }
    expect(r.filled).toBeGreaterThanOrEqual(3);
  });

  it("30. a valid EXPLICIT local value stays authoritative; a differing automatic value is only FLAGGED", () => {
    const r = mergeCompletion(fields({ color: val("أبيض"), manufactureYear: val(2019) }), automatic);
    expect(r.fields.color).toMatchObject({ normalizedValue: "أبيض", confidence: "HIGH" });
    expect(r.fields.color.warnings).toContain(COMPLETION_DIFFERS_WARNING);
    expect(r.fields.manufactureYear.normalizedValue).toBe(2019);
    expect(r.differs).toBe(2);
  });

  it("3. agreement keeps the local value and upgrades nothing", () => {
    const local = fields({ plateNumber: val("T 99001", "MEDIUM") });
    const r = mergeCompletion(local, automatic);
    expect(r.fields.plateNumber).toEqual(local.plateNumber);
  });

  it("32. a DERIVED local value that disagrees becomes a CONFLICT with both alternatives — nothing is chosen", () => {
    const r = mergeCompletion(fields({ model: val("Testmodel", "LOW", ["HEURISTIC_SPLIT"]) }), automatic);
    expect(r.fields.model).toMatchObject({ normalizedValue: null, confidence: "LOW", alternatives: ["Testmodel", "6"] });
    expect(r.fields.model.warnings).toEqual(["CONFLICT", COMPLETION_CONFLICT_WARNING]);
    expect(r.conflicts).toBe(1);
  });

  it("an existing local CONFLICT stays exactly as it is", () => {
    const conflict = { rawValue: "6", normalizedValue: null, confidence: "LOW" as const, warnings: ["CONFLICT"], alternatives: ["6", "6 GXR"] };
    const r = mergeCompletion(fields({ model: conflict }), automatic);
    expect(r.fields.model).toEqual(conflict);
  });

  it("an automatic CONFLICT on an unresolved field is carried over as a conflict (both values offered)", () => {
    const auto = buildRegistrationExtraction({ model: [{ text: "6" }, { text: "3" }] }, { source: "OCR" }).fields;
    const r = mergeCompletion(fields(), auto);
    expect(r.fields.model.warnings).toContain("CONFLICT");
    expect(r.fields.model.normalizedValue).toBeNull();
  });

  it("the merge never adds a key outside the allowlist and never invents a value the automatic reading did not have", () => {
    const r = mergeCompletion(fields(), buildRegistrationExtraction({}, { source: "OCR" }).fields);
    expect(Object.keys(r.fields).sort()).toEqual([...REGISTRATION_FIELD_KEYS].sort());
    for (const k of REGISTRATION_FIELD_KEYS) expect(r.fields[k].normalizedValue).toBeNull();
    expect(r.filled).toBe(0);
  });
});

describe("candidatesFromStoredFields — local re-derivation input for a stale stored automatic reading", () => {
  it("rebuilds explicit values, every conflict alternative, and the unclear flag; skips derived fields", () => {
    const c = candidatesFromStoredFields({
      color: { rawValue: "White", normalizedValue: "White", confidence: "MEDIUM", warnings: ["OCR_UNCLEAR"] },
      model: { rawValue: "6", normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives: ["6", "6 GXR"] },
      makeDescription: { rawValue: "مازدا صالون 6", normalizedValue: "Mazda", confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] },
      vehicleDescription: { rawValue: "مازدا صالون 6", normalizedValue: "مازدا صالون 6", confidence: "MEDIUM", warnings: [] },
    });
    expect(c.color).toEqual([{ text: "White", unclear: true }]);
    expect(c.model).toEqual([{ text: "6", unclear: false }, { text: "6 GXR", unclear: false }]);
    expect(c.makeDescription).toBeUndefined();
    expect(c.vehicleDescription).toEqual([{ text: "مازدا صالون 6", unclear: false }]);
  });
});
