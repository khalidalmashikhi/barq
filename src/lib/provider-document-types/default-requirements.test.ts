import { describe, it, expect } from "vitest";
import type { ProviderType } from "@prisma/client";
import { DEFAULT_VERIFICATION_REQUIREMENTS } from "./default-requirements";
import { requiredDocumentTypesFor } from "./requirements";
import { isValidProviderDocumentTypeKey } from "./registry";

// ADR-0017 — DEFAULT_VERIFICATION_REQUIREMENTS is the single source shared by the
// staging seed AND the fail-closed fallback. These tests pin the exact default
// policy and — critically — guard that it agrees with the code-default required
// map (requirements.ts), so the seeded policy reproduces today's BR-029 behaviour
// EXACTLY and the two sources can never silently drift.

describe("DEFAULT_VERIFICATION_REQUIREMENTS — exact default policy", () => {
  it("declares exactly the three default requirements with the correct mapping", () => {
    expect(DEFAULT_VERIFICATION_REQUIREMENTS.map((d) => ({ key: d.key, appliesTo: d.appliesTo, required: d.required, active: d.active }))).toEqual([
      { key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: true, active: true },
      { key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, active: true },
      { key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false, active: true },
    ]);
  });

  it("every default key is a valid code-registry key (stable code, never a label)", () => {
    for (const d of DEFAULT_VERIFICATION_REQUIREMENTS) {
      expect(isValidProviderDocumentTypeKey(d.key)).toBe(true);
    }
  });

  it("carries bilingual {ar,en} name + description for each requirement", () => {
    for (const d of DEFAULT_VERIFICATION_REQUIREMENTS) {
      expect(d.name.ar.length).toBeGreaterThan(0);
      expect(d.name.en.length).toBeGreaterThan(0);
      expect(d.description.ar.length).toBeGreaterThan(0);
      expect(d.description.en.length).toBeGreaterThan(0);
    }
  });

  it("the INDIVIDUAL identity requirement asks for a Civil/National ID and no longer mentions passport (Gate 0)", () => {
    const identity = DEFAULT_VERIFICATION_REQUIREMENTS.find((d) => d.key === "IDENTITY_PROOF");
    expect(identity).toBeDefined();
    const en = identity!.description.en.toLowerCase();
    const ar = identity!.description.ar;
    expect(en).not.toContain("passport");
    expect(ar).not.toContain("جواز"); // no "passport" in Arabic either
    expect(en).toContain("civil"); // now Civil / National ID
    expect(ar).toContain("المدنية");
  });

  it("has unique keys and unique sortOrders", () => {
    const keys = DEFAULT_VERIFICATION_REQUIREMENTS.map((d) => d.key);
    const sorts = DEFAULT_VERIFICATION_REQUIREMENTS.map((d) => d.sortOrder);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(sorts).size).toBe(sorts.length);
  });
});

describe("DEFAULT_VERIFICATION_REQUIREMENTS ↔ code default map consistency", () => {
  // The required set derived from the defaults MUST equal requiredDocumentTypesFor
  // for each provider type — otherwise the seeded policy and the fail-closed
  // fallback would disagree on what BR-029 requires.
  function requiredFromDefaults(providerType: ProviderType): string[] {
    return DEFAULT_VERIFICATION_REQUIREMENTS.filter(
      (d) => d.active && d.required && (d.appliesTo === providerType || d.appliesTo === "BOTH")
    ).map((d) => d.key);
  }

  it("agrees with requiredDocumentTypesFor for INDIVIDUAL", () => {
    expect(requiredFromDefaults("INDIVIDUAL")).toEqual(requiredDocumentTypesFor({ providerType: "INDIVIDUAL" }));
  });

  it("agrees with requiredDocumentTypesFor for COMPANY", () => {
    expect(requiredFromDefaults("COMPANY")).toEqual(requiredDocumentTypesFor({ providerType: "COMPANY" }));
  });
});
