import { requiredDocumentTypesFor, type ProviderRequirementContext } from "./requirements";

// Fail-closed verification-policy resolution — ADR-0017 (configurable provider
// verification requirements, Level 2).
//
// This is the SAFE-FAILURE primitive for the future DB-backed policy path: given
// the admin-configured requirement rows, it returns the REQUIRED document-type
// keys for a provider. It is intentionally PURE and dependency-free (no DB, no
// I/O) so the fail-closed contract can be unit-tested in isolation; the live
// wiring (reading ProviderVerificationRequirement and feeding
// assertProviderApprovable) lands in a later, separately-approved gate. The
// existing code-default map (requirements.ts) is UNCHANGED and is reused here as
// the fallback, so behaviour is identical until that wiring happens.
//
// FAIL CLOSED (11-SECURITY-POLICY.md / BR-029): a configuration/database FAILURE
// must never silently allow an unvetted provider to be approved.
//   - `policyRows === null`  → the policy table could not be read (DB error /
//     unavailable) → fall back to the CODE-DEFAULT required set.
//   - `policyRows.length === 0` → the table is unseeded (the default rows are
//     always seeded via bootstrap; an empty table is treated as a failure, not a
//     legitimate "require nothing") → fall back to the CODE-DEFAULT required set.
//   - a NON-empty policy is the admin's explicit, authoritative configuration and
//     is used as-is — even if it yields zero required documents, that is a
//     deliberate admin choice, not a failure (assertProviderApprovable still runs
//     and simply finds no blockers; approval is never BYPASSED, only satisfied).
//
// The fallback is the non-empty code-default set — NEVER an empty "require
// nothing" — which is what makes the failure mode closed rather than open.

export type VerificationRequirementAudience = "INDIVIDUAL" | "COMPANY" | "BOTH";

// The minimal shape read from ProviderVerificationRequirement for this decision.
export type VerificationRequirementPolicyRow = {
  key: string;
  appliesTo: VerificationRequirementAudience;
  required: boolean;
  active: boolean;
};

/**
 * The REQUIRED verification document-type keys for a provider, resolved from the
 * admin policy with a fail-CLOSED fallback to the code defaults. Pure; no I/O.
 *
 * @param policyRows the configured rows, or `null` when the policy table could
 *   not be read (DB error / unavailable). An empty array is treated the same as
 *   `null` (unseeded → fail closed).
 */
export function resolveRequiredKeysFromPolicy(
  policyRows: readonly VerificationRequirementPolicyRow[] | null,
  provider: ProviderRequirementContext
): string[] {
  // Fail closed: an unreadable OR unseeded policy falls back to the code defaults
  // (a non-empty required set), never to "require nothing".
  if (policyRows === null || policyRows.length === 0) {
    return requiredDocumentTypesFor(provider);
  }

  // Authoritative admin policy: active + required rows whose audience covers this
  // provider type (its own type, or the BOTH convenience).
  return policyRows
    .filter(
      (row) =>
        row.active &&
        row.required &&
        (row.appliesTo === provider.providerType || row.appliesTo === "BOTH")
    )
    .map((row) => row.key);
}
