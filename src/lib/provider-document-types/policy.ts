import { requiredDocumentTypesFor, type ProviderRequirementContext } from "./requirements";
import { isValidProviderDocumentTypeKey } from "./registry";
import {
  DEFAULT_VERIFICATION_REQUIREMENTS,
  type VerificationRequirementAudience,
} from "./default-requirements";

// The audience type is owned by ./default-requirements (the lowest-level pure
// data module) and re-exported here for the existing policy-row consumers.
export type { VerificationRequirementAudience };

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

// ---------------------------------------------------------------------------
// Full provider verification CHECKLIST resolution (for the provider-facing
// /verification page and dashboard readiness card). Same fail-closed contract as
// resolveRequiredKeysFromPolicy, but returns the ordered, applicable checklist
// rows — required AND optional — each carrying its bilingual name/description for
// rendering. Pure; no I/O. `name`/`description` are passed through untouched (raw
// JSON locale maps from the DB, or the {ar,en} defaults) for extractLocalizedText.
// ---------------------------------------------------------------------------

// The fuller row shape read from ProviderVerificationRequirement for the checklist.
export type VerificationRequirementChecklistRow = {
  key: string;
  name: unknown;
  description: unknown;
  appliesTo: VerificationRequirementAudience;
  required: boolean;
  active: boolean;
  sortOrder: number;
};

export type ResolvedChecklistRequirement = {
  key: string;
  required: boolean;
  name: unknown; // bilingual locale map (raw JSON) — render via extractLocalizedText
  description: unknown; // bilingual locale map or null
};

function audienceCovers(appliesTo: VerificationRequirementAudience, provider: ProviderRequirementContext): boolean {
  return appliesTo === provider.providerType || appliesTo === "BOTH";
}

/**
 * The ordered verification checklist (required + optional) applicable to a
 * provider, resolved from the admin policy with a fail-CLOSED fallback to the
 * code defaults. Rows are filtered to active + audience-applicable and ordered by
 * sortOrder. Pure; no I/O.
 *
 * @param policyRows configured rows, or `null` when the table could not be read.
 *   `null` or `[]` (unseeded) → the code-default requirements (never "nothing").
 */
export function resolveVerificationChecklist(
  policyRows: readonly VerificationRequirementChecklistRow[] | null,
  provider: ProviderRequirementContext
): ResolvedChecklistRequirement[] {
  // Fail closed: an unreadable OR unseeded policy falls back to the code defaults.
  if (policyRows === null || policyRows.length === 0) {
    return DEFAULT_VERIFICATION_REQUIREMENTS.filter(
      (d) => d.active && audienceCovers(d.appliesTo, provider)
    ).map((d) => ({ key: d.key, required: d.required, name: d.name, description: d.description }));
  }

  // Authoritative admin policy: active + audience-applicable rows, ordered.
  return [...policyRows]
    .filter((row) => row.active && audienceCovers(row.appliesTo, provider))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({ key: row.key, required: row.required, name: row.name, description: row.description }));
}

// ---------------------------------------------------------------------------
// Upload type acceptance (ADR-0017 Phase 4). Removes the old hard restriction to
// the three registry keys WITHOUT accepting arbitrary client strings. A type is
// uploadable iff it is EITHER:
//   (a) a code-registry key — the safe, justified COMPATIBILITY rule: it keeps
//       the three default keys (and any historical ProviderDocument.type value,
//       which are registry keys) permanently valid, AND is the FAIL-SAFE path
//       when the policy cannot be read (null) so a DB hiccup never blocks the
//       default uploads; OR
//   (b) an ACTIVE configured requirement key — an admin-created key becomes
//       uploadable once (and only while) its requirement row is active.
// Anything else (an arbitrary/unknown string) is rejected. This never mutates or
// invents a key; the key stays a stable code, never a customer-facing label.
// ---------------------------------------------------------------------------

// The minimal shape needed to decide upload acceptance.
export type UploadPolicyRow = { key: string; active: boolean };

export function isUploadableDocumentType(
  type: string,
  policyRows: readonly UploadPolicyRow[] | null
): boolean {
  // (a) Registry/compatibility + fail-safe (also covers a null/unreadable policy).
  if (isValidProviderDocumentTypeKey(type)) return true;
  if (policyRows === null) return false;
  // (b) An admin-created key is accepted only while its row is active.
  return policyRows.some((row) => row.active && row.key === type);
}
