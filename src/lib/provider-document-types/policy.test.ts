import { describe, it, expect } from "vitest";
import {
  resolveRequiredKeysFromPolicy,
  resolveVerificationChecklist,
  isUploadableDocumentType,
  type VerificationRequirementPolicyRow,
  type VerificationRequirementChecklistRow,
} from "./policy";

// ADR-0017 fail-closed contract. The critical safety property: a configuration or
// database FAILURE must never silently reduce the required document set to
// nothing (which would let an unvetted provider be approved). Both the DB-error
// (null) and unseeded (empty) inputs must fall back to the non-empty code
// defaults; a non-empty admin policy is authoritative.

const INDIVIDUAL = { providerType: "INDIVIDUAL" } as const;
const COMPANY = { providerType: "COMPANY" } as const;

function row(o: Partial<VerificationRequirementPolicyRow> & { key: string }): VerificationRequirementPolicyRow {
  return { appliesTo: "BOTH", required: true, active: true, ...o };
}

describe("resolveRequiredKeysFromPolicy — fail-closed fallback", () => {
  it("falls back to the code default when the policy is NULL (DB read failure)", () => {
    // Fail CLOSED — not an empty set.
    expect(resolveRequiredKeysFromPolicy(null, INDIVIDUAL)).toEqual(["IDENTITY_PROOF"]);
    expect(resolveRequiredKeysFromPolicy(null, COMPANY)).toEqual(["COMMERCIAL_REGISTRATION"]);
  });

  it("falls back to the code default when the policy table is EMPTY (unseeded)", () => {
    expect(resolveRequiredKeysFromPolicy([], INDIVIDUAL)).toEqual(["IDENTITY_PROOF"]);
    expect(resolveRequiredKeysFromPolicy([], COMPANY)).toEqual(["COMMERCIAL_REGISTRATION"]);
  });

  it("never returns an empty required set on failure (the closed-failure invariant)", () => {
    for (const provider of [INDIVIDUAL, COMPANY]) {
      expect(resolveRequiredKeysFromPolicy(null, provider).length).toBeGreaterThan(0);
      expect(resolveRequiredKeysFromPolicy([], provider).length).toBeGreaterThan(0);
    }
  });
});

describe("resolveRequiredKeysFromPolicy — authoritative admin policy", () => {
  it("uses the configured rows (default-preserving example) for a COMPANY", () => {
    const policy = [
      row({ key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: true }),
      row({ key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true }),
      row({ key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false }),
    ];
    expect(resolveRequiredKeysFromPolicy(policy, COMPANY)).toEqual(["COMMERCIAL_REGISTRATION"]);
  });

  it("does NOT require the other type's document (INDIVIDUAL not blocked by COMMERCIAL_REGISTRATION)", () => {
    const policy = [
      row({ key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: true }),
      row({ key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true }),
    ];
    expect(resolveRequiredKeysFromPolicy(policy, INDIVIDUAL)).toEqual(["IDENTITY_PROOF"]);
  });

  it("applies a BOTH audience to both provider types", () => {
    const policy = [row({ key: "IDENTITY_PROOF", appliesTo: "BOTH", required: true })];
    expect(resolveRequiredKeysFromPolicy(policy, INDIVIDUAL)).toEqual(["IDENTITY_PROOF"]);
    expect(resolveRequiredKeysFromPolicy(policy, COMPANY)).toEqual(["IDENTITY_PROOF"]);
  });

  it("excludes optional rows", () => {
    const policy = [row({ key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false })];
    expect(resolveRequiredKeysFromPolicy(policy, COMPANY)).toEqual([]);
  });

  it("excludes inactive rows even if required", () => {
    const policy = [row({ key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: true, active: false })];
    expect(resolveRequiredKeysFromPolicy(policy, INDIVIDUAL)).toEqual([]);
  });

  it("honours a deliberate admin 'nothing required' policy for a non-empty table (not a failure)", () => {
    // All rows optional → zero required is the admin's explicit choice; the table
    // is non-empty, so we do NOT fail closed to defaults here.
    const policy = [
      row({ key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: false }),
      row({ key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: false }),
    ];
    expect(resolveRequiredKeysFromPolicy(policy, COMPANY)).toEqual([]);
    expect(resolveRequiredKeysFromPolicy(policy, INDIVIDUAL)).toEqual([]);
  });
});

function checklistRow(
  o: Partial<VerificationRequirementChecklistRow> & { key: string }
): VerificationRequirementChecklistRow {
  return {
    name: { ar: `${o.key}-ar`, en: `${o.key}-en` },
    description: null,
    appliesTo: "BOTH",
    required: false,
    active: true,
    sortOrder: 0,
    ...o,
  };
}

describe("resolveVerificationChecklist — fail-closed fallback", () => {
  it("falls back to the default checklist on NULL (DB failure) — never empty", () => {
    const individual = resolveVerificationChecklist(null, INDIVIDUAL);
    expect(individual.map((r) => r.key)).toEqual(["IDENTITY_PROOF", "TOURISM_LICENCE"]);
    expect(individual.find((r) => r.key === "IDENTITY_PROOF")!.required).toBe(true);
    expect(individual.find((r) => r.key === "TOURISM_LICENCE")!.required).toBe(false);

    const company = resolveVerificationChecklist(null, COMPANY);
    expect(company.map((r) => r.key)).toEqual(["COMMERCIAL_REGISTRATION", "TOURISM_LICENCE"]);
  });

  it("falls back to the default checklist on an EMPTY table (unseeded)", () => {
    expect(resolveVerificationChecklist([], COMPANY).map((r) => r.key)).toEqual([
      "COMMERCIAL_REGISTRATION",
      "TOURISM_LICENCE",
    ]);
  });

  it("returns the default bilingual name/description in the fallback", () => {
    const item = resolveVerificationChecklist(null, INDIVIDUAL).find((r) => r.key === "IDENTITY_PROOF")!;
    expect(item.name).toEqual({ ar: "إثبات الهوية", en: "Identity Proof" });
    expect(item.description).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
  });
});

describe("resolveVerificationChecklist — authoritative policy", () => {
  it("reflects the configured rows, audience-filtered and ordered by sortOrder", () => {
    const policy = [
      checklistRow({ key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false, sortOrder: 2 }),
      checklistRow({ key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, sortOrder: 1 }),
      checklistRow({ key: "IDENTITY_PROOF", appliesTo: "INDIVIDUAL", required: true, sortOrder: 0 }),
    ];
    // COMPANY sees only its own + BOTH, ordered by sortOrder.
    expect(resolveVerificationChecklist(policy, COMPANY).map((r) => r.key)).toEqual([
      "COMMERCIAL_REGISTRATION",
      "TOURISM_LICENCE",
    ]);
  });

  it("excludes inactive rows from the checklist", () => {
    const policy = [
      checklistRow({ key: "COMMERCIAL_REGISTRATION", appliesTo: "COMPANY", required: true, active: false }),
      checklistRow({ key: "TOURISM_LICENCE", appliesTo: "BOTH", required: false, active: true }),
    ];
    expect(resolveVerificationChecklist(policy, COMPANY).map((r) => r.key)).toEqual(["TOURISM_LICENCE"]);
  });

  it("passes the configured name/description through untouched (for extractLocalizedText)", () => {
    const policy = [
      checklistRow({
        key: "VAT_CERTIFICATE",
        appliesTo: "COMPANY",
        required: true,
        name: { ar: "ضريبة", en: "VAT" },
        description: { ar: "وصف", en: "desc" },
      }),
    ];
    const item = resolveVerificationChecklist(policy, COMPANY)[0]!;
    expect(item.name).toEqual({ ar: "ضريبة", en: "VAT" });
    expect(item.description).toEqual({ ar: "وصف", en: "desc" });
  });
});

describe("isUploadableDocumentType", () => {
  it("accepts every code registry key (compatibility + historical), regardless of policy", () => {
    for (const key of ["IDENTITY_PROOF", "COMMERCIAL_REGISTRATION", "TOURISM_LICENCE"]) {
      expect(isUploadableDocumentType(key, [])).toBe(true);
      expect(isUploadableDocumentType(key, null)).toBe(true);
    }
  });

  it("rejects an arbitrary/unknown key", () => {
    expect(isUploadableDocumentType("PASSPORT", [])).toBe(false);
    expect(isUploadableDocumentType("../etc/passwd", [])).toBe(false);
  });

  it("accepts an ACTIVE configured custom key", () => {
    expect(isUploadableDocumentType("VAT_CERTIFICATE", [{ key: "VAT_CERTIFICATE", active: true }])).toBe(true);
  });

  it("rejects an INACTIVE configured custom key", () => {
    expect(isUploadableDocumentType("VAT_CERTIFICATE", [{ key: "VAT_CERTIFICATE", active: false }])).toBe(false);
  });

  it("fail-safe: on a null policy (DB error) only registry keys are accepted, arbitrary rejected", () => {
    expect(isUploadableDocumentType("VAT_CERTIFICATE", null)).toBe(false);
    expect(isUploadableDocumentType("IDENTITY_PROOF", null)).toBe(true);
  });
});
