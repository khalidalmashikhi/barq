import { PrismaClient } from "@prisma/client";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
} from "../src/lib/categories/staging-taxonomy-bootstrap";
import {
  runVerticalRequirementBootstrap,
  type VerificationRequirementBootstrapPrisma,
} from "../src/lib/provider-document-types/verification-requirement-bootstrap";

// Phase 3B — Phase 1. Provider-VERTICAL verification requirements — STAGING bootstrap runner.
//
// A thin, env-guarded CLI wrapper around runVerticalRequirementBootstrap. Same two guards as the
// other bootstraps (APP_ENV=staging AND DATABASE_URL points at the real staging pooler), DRY-RUN by
// default, idempotent (insert-if-absent; never overwrites an admin-edited row, never deletes),
// prints only non-sensitive keys/actions.
//
// This seeds the MINIMUM vertical policy — RENTAL_ACTIVITY_LICENCE + RENTAL_BUSINESS_REGISTRATION
// (RENTAL_COMPANY) and TOURIST_GUIDE_LICENCE (TOURIST_GUIDE), all required + evidence-expiring. It
// MUST run (and be verified) BEFORE vertical approval endpoints become usable: an unseeded vertical
// fails closed (VERTICAL_POLICY_NOT_CONFIGURED), so approvals are safely blocked until this runs.
//
// USAGE (from an environment whose DATABASE_URL points at STAGING):
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-vertical-requirements.ts          # dry-run
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-vertical-requirements.ts --apply  # execute

let prisma: PrismaClient | undefined;

function labelFor(action: string, applied: boolean): string {
  if (applied) return action;
  if (action === "created") return "would-create";
  return action;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN (no changes)";

  try {
    assertStagingEnvironment(process.env.APP_ENV);
    assertStagingDatabaseTarget(process.env.DATABASE_URL);
  } catch (error) {
    if (error instanceof StagingGuardError || error instanceof StagingDatabaseTargetError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log("=== BARQ provider VERTICAL verification requirements staging bootstrap (Phase 3B P1) ===");
  console.log(`mode: ${mode}`);

  prisma = new PrismaClient();

  const report = await runVerticalRequirementBootstrap(prisma as unknown as VerificationRequirementBootstrapPrisma, { apply });

  console.log("\nVertical verification requirements:");
  for (const r of report.requirements) {
    console.log(`  - ${r.key.padEnd(32)} ${labelFor(r.action, report.applied)}`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
  } else {
    console.log(
      "\nApplied inside idempotent insert-if-absent semantics — re-running converges to the same " +
        "state and never overwrites an admin-edited requirement."
    );
  }
}

main()
  .catch((error) => {
    console.error("bootstrap-staging-vertical-requirements failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
