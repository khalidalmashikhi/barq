import {
  DEFAULT_VERIFICATION_REQUIREMENTS,
  VERTICAL_VERIFICATION_REQUIREMENTS,
  type DefaultVerificationRequirement,
  type VerificationRequirementAudience,
} from "./default-requirements";

// ADR-0017 — STAGING bootstrap core for the default provider verification policy.
//
// Pure, dependency-injected (the Prisma client is passed in) so the same logic
// runs under `tsx` (scripts/bootstrap-staging-verification-requirements.ts) and
// under vitest with a mock client. Mirrors the ADR-0016 taxonomy bootstrap
// exactly:
//   - INSERT-IF-ABSENT by `key` — never overwrites an admin-edited existing row
//     (labels/flags an admin changed are preserved on re-run),
//   - never deletes a requirement,
//   - never touches ProviderDocument rows,
//   - dry-run by default; writes only when options.apply is true,
//   - idempotent: re-running converges to the same state (every row "exists").
//
// It seeds exactly DEFAULT_VERIFICATION_REQUIREMENTS (the single source shared
// with the fail-closed fallback), so the seeded policy reproduces the pre-Level-2
// hard-coded behaviour exactly: IDENTITY_PROOF/INDIVIDUAL/required,
// COMMERCIAL_REGISTRATION/COMPANY/required, TOURISM_LICENCE/BOTH/optional.

export type RequirementRow = { id: string; key: string };

export interface VerificationRequirementBootstrapPrisma {
  providerVerificationRequirement: {
    findUnique(args: { where: { key: string } }): Promise<RequirementRow | null>;
    create(args: {
      data: {
        key: string;
        name: { ar: string; en: string };
        description: { ar: string; en: string };
        appliesTo: VerificationRequirementAudience;
        required: boolean;
        active: boolean;
        sortOrder: number;
        // Phase 3B Phase 1 — optional; omitted rows default to false (non-expiring) at the DB.
        evidenceExpires?: boolean;
      };
    }): Promise<RequirementRow>;
  };
}

// "created" means created when applied=true, and "would create" when applied=false.
export type RequirementAction = "created" | "exists";
export type RequirementOutcome = { key: string; action: RequirementAction; id: string | null };
export type VerificationRequirementBootstrapReport = { applied: boolean; requirements: RequirementOutcome[] };

// Shared insert-if-absent seeding for a set of requirement definitions. NEVER overwrites an
// admin-edited existing row (matched by key) and never deletes — idempotent by construction.
async function seedRequirements(
  prisma: VerificationRequirementBootstrapPrisma,
  defs: readonly DefaultVerificationRequirement[],
  apply: boolean
): Promise<RequirementOutcome[]> {
  const requirements: RequirementOutcome[] = [];
  for (const def of defs) {
    const existing = await prisma.providerVerificationRequirement.findUnique({ where: { key: def.key } });
    if (existing) {
      requirements.push({ key: def.key, action: "exists", id: existing.id });
    } else if (apply) {
      const created = await prisma.providerVerificationRequirement.create({
        data: {
          key: def.key,
          name: def.name,
          description: def.description,
          appliesTo: def.appliesTo,
          required: def.required,
          active: def.active,
          sortOrder: def.sortOrder,
          evidenceExpires: def.evidenceExpires ?? false,
        },
      });
      requirements.push({ key: def.key, action: "created", id: created.id });
    } else {
      requirements.push({ key: def.key, action: "created", id: null });
    }
  }
  return requirements;
}

export async function runVerificationRequirementBootstrap(
  prisma: VerificationRequirementBootstrapPrisma,
  options: { apply: boolean }
): Promise<VerificationRequirementBootstrapReport> {
  const requirements = await seedRequirements(prisma, DEFAULT_VERIFICATION_REQUIREMENTS, options.apply);
  return { applied: options.apply, requirements };
}

// Phase 3B — Phase 1. Idempotent bootstrap for the provider-VERTICAL requirement policy
// (RENTAL_COMPANY + TOURIST_GUIDE). Same insert-if-absent semantics: never overwrites an
// admin-edited row, never deletes, dry-run by default. Seeding these is what lifts a vertical out of
// the fail-closed POLICY_NOT_CONFIGURED state, so this MUST run before vertical approval endpoints
// become usable (see the deployment-order plan). It does NOT touch the INDIVIDUAL/COMPANY defaults.
export async function runVerticalRequirementBootstrap(
  prisma: VerificationRequirementBootstrapPrisma,
  options: { apply: boolean }
): Promise<VerificationRequirementBootstrapReport> {
  const requirements = await seedRequirements(prisma, VERTICAL_VERIFICATION_REQUIREMENTS, options.apply);
  return { applied: options.apply, requirements };
}
