import { DEFAULT_VERIFICATION_REQUIREMENTS } from "./default-requirements";

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
        appliesTo: "INDIVIDUAL" | "COMPANY" | "BOTH";
        required: boolean;
        active: boolean;
        sortOrder: number;
      };
    }): Promise<RequirementRow>;
  };
}

// "created" means created when applied=true, and "would create" when applied=false.
export type RequirementAction = "created" | "exists";
export type RequirementOutcome = { key: string; action: RequirementAction; id: string | null };
export type VerificationRequirementBootstrapReport = { applied: boolean; requirements: RequirementOutcome[] };

export async function runVerificationRequirementBootstrap(
  prisma: VerificationRequirementBootstrapPrisma,
  options: { apply: boolean }
): Promise<VerificationRequirementBootstrapReport> {
  const { apply } = options;
  const requirements: RequirementOutcome[] = [];

  for (const def of DEFAULT_VERIFICATION_REQUIREMENTS) {
    const existing = await prisma.providerVerificationRequirement.findUnique({ where: { key: def.key } });
    if (existing) {
      // Insert-if-absent: an already-present requirement (possibly admin-edited)
      // is left EXACTLY as-is — never overwritten, never deleted.
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
        },
      });
      requirements.push({ key: def.key, action: "created", id: created.id });
    } else {
      requirements.push({ key: def.key, action: "created", id: null });
    }
  }

  return { applied: apply, requirements };
}
