import { describe, it, expect } from "vitest";
import { resolveRequiredKeysFromPolicy, type VerificationRequirementPolicyRow } from "./policy";

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
