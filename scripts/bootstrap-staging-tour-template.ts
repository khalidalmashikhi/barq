import { PrismaClient } from "@prisma/client";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
} from "../src/lib/categories/staging-taxonomy-bootstrap";
import { runTourTemplateBootstrap, type TourTemplateBootstrapPrisma } from "../src/lib/tour-template/bootstrap";

// Smart Tour-Guide Template — STAGING config bootstrap runner.
//
// A thin, env-guarded CLI wrapper around the pure core in
// src/lib/tour-template/bootstrap.ts. It reuses the SAME two guards as the
// taxonomy / verification bootstraps (APP_ENV=staging AND DATABASE_URL points at
// the real staging Supabase pooler), is DRY-RUN by default (writes only with
// --apply), is idempotent (insert-if-absent; never overwrites an admin-edited
// row, never deletes), and prints only non-sensitive keys/actions — never
// DATABASE_URL or any secret.
//
// USAGE (from an environment whose DATABASE_URL points at STAGING):
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-tour-template.ts          # dry-run
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-tour-template.ts --apply  # execute
// or:
//   APP_ENV=staging npm run bootstrap-staging-tour-template -- --apply

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

  console.log("=== BARQ Smart Tour-Guide Template staging bootstrap ===");
  console.log(`mode: ${mode}`);

  // Only now — after both guards pass — instantiate the client.
  prisma = new PrismaClient();

  const report = await runTourTemplateBootstrap(prisma as unknown as TourTemplateBootstrapPrisma, { apply });

  const section = (title: string, outcomes: { key: string; action: string }[]) => {
    console.log(`\n${title}:`);
    for (const o of outcomes) {
      console.log(`  - ${o.key.padEnd(24)} ${labelFor(o.action, report.applied)}`);
    }
  };

  section("Package presets", report.packages);
  section("Vehicle type options", report.vehicleTypes);
  section("Template texts", report.templateTexts);
  section("Field rules", report.fieldRules);

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
  } else {
    console.log(
      "\nApplied inside idempotent insert-if-absent semantics — re-running converges to the " +
        "same state and never overwrites an admin-edited row."
    );
  }
}

main()
  .catch((error) => {
    console.error("bootstrap-staging-tour-template failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
