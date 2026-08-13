import { PrismaClient } from "@prisma/client";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
} from "../src/lib/categories/staging-taxonomy-bootstrap";
import {
  runVerificationRequirementBootstrap,
  type VerificationRequirementBootstrapPrisma,
} from "../src/lib/provider-document-types/verification-requirement-bootstrap";

// ADR-0017 — provider verification requirements — STAGING bootstrap runner.
//
// A thin, env-guarded CLI wrapper around the pure core in
// src/lib/provider-document-types/verification-requirement-bootstrap.ts. It:
//   - refuses to run unless APP_ENV=staging (never production, never local) AND
//     DATABASE_URL points at the real BARQ staging Supabase pooler — the SAME
//     two guards the taxonomy bootstrap uses (reused, not re-implemented),
//   - is DRY-RUN by default and only mutates with --apply,
//   - is idempotent (insert-if-absent; never overwrites an admin-edited row,
//     never deletes, never touches ProviderDocument rows),
//   - seeds exactly the three default requirements (IDENTITY_PROOF/INDIVIDUAL/
//     required, COMMERCIAL_REGISTRATION/COMPANY/required, TOURISM_LICENCE/BOTH/
//     optional), reproducing today's hard-coded BR-029 behaviour exactly,
//   - prints only non-sensitive data (keys, actions). It never reads or prints
//     DATABASE_URL or any secret.
//
// USAGE (from an environment whose DATABASE_URL points at STAGING):
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-verification-requirements.ts          # dry-run
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-verification-requirements.ts --apply  # execute
// or via package.json:
//   APP_ENV=staging npm run bootstrap-staging-verification-requirements -- --apply

let prisma: PrismaClient | undefined;

function labelFor(action: string, applied: boolean): string {
  if (applied) return action;
  if (action === "created") return "would-create";
  return action;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN (no changes)";

  // Guards — BOTH before any DB access, before the client is even built.
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

  console.log("=== BARQ provider verification requirements staging bootstrap (ADR-0017) ===");
  console.log(`mode: ${mode}`);

  // Only now — after both guards pass — instantiate the client.
  prisma = new PrismaClient();

  const report = await runVerificationRequirementBootstrap(
    prisma as unknown as VerificationRequirementBootstrapPrisma,
    { apply }
  );

  console.log("\nDefault verification requirements:");
  for (const r of report.requirements) {
    console.log(`  - ${r.key.padEnd(24)} ${labelFor(r.action, report.applied)}`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
  } else {
    console.log(
      "\nApplied inside idempotent insert-if-absent semantics — re-running converges to the " +
        "same state and never overwrites an admin-edited requirement."
    );
  }
}

main()
  .catch((error) => {
    console.error(
      "bootstrap-staging-verification-requirements failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
