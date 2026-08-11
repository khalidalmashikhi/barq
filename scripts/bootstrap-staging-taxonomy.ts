import { PrismaClient } from "@prisma/client";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
  runStagingTaxonomyBootstrap,
  type TaxonomyBootstrapPrisma,
} from "../src/lib/categories/staging-taxonomy-bootstrap";

// BARQ v1 marketplace taxonomy — STAGING bootstrap runner (ADR-0016).
//
// A thin, env-guarded CLI wrapper around the pure core in
// src/lib/categories/staging-taxonomy-bootstrap.ts. It:
//   - refuses to run unless APP_ENV=staging (never production, never local),
//   - is DRY-RUN by default and only mutates with --apply,
//   - is idempotent (insert-if-absent; never overwrites an admin-edited row),
//   - creates the approved 4 roots + 4 children (PUBLIC on creation),
//   - archives the junk categories (slugs "1"/"2") ONLY when they have no
//     Service, ProviderCategory, or child dependency — never hard-deletes,
//   - prints only non-sensitive data (slugs, actions, dependency counts). It
//     never reads or prints DATABASE_URL or any secret.
//
// USAGE (from an environment whose DATABASE_URL points at STAGING):
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-taxonomy.ts            # dry-run
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-taxonomy.ts --apply    # execute
// or via package.json:
//   APP_ENV=staging npm run bootstrap-staging-taxonomy -- --apply

// Constructed only AFTER both guards pass (see main), so a rejected target
// never even instantiates a client. Kept module-scoped so `finally` can
// disconnect it.
let prisma: PrismaClient | undefined;

function labelFor(action: string, applied: boolean): string {
  if (applied) return action;
  if (action === "created") return "would-create";
  if (action === "archived") return "would-archive";
  return action;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN (no changes)";

  // 1. Guards — BOTH before any DB access, before the client is even built:
  //    (a) APP_ENV must be staging; (b) DATABASE_URL must point at the real
  //    BARQ staging Supabase pooler (not localhost / not another project).
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

  console.log("=== BARQ v1 staging taxonomy bootstrap (ADR-0016) ===");
  console.log(`mode: ${mode}`);

  // Only now — after both guards pass — instantiate the client.
  prisma = new PrismaClient();

  // The real PrismaClient structurally satisfies the narrow bootstrap surface;
  // the cast is only to bridge Prisma's broad generic delegate types to the
  // minimal interface the core depends on (a mock implements it directly in tests).
  const report = await runStagingTaxonomyBootstrap(
    prisma as unknown as TaxonomyBootstrapPrisma,
    { apply }
  );

  console.log("\nRoots (customer-facing, PUBLIC):");
  for (const r of report.roots) {
    console.log(`  - ${r.slug.padEnd(18)} ${labelFor(r.action, report.applied)}`);
  }

  console.log("Children of tours-experiences (EXPERIENCE, PUBLIC):");
  for (const c of report.children) {
    console.log(`  - ${c.slug.padEnd(18)} ${labelFor(c.action, report.applied)}`);
  }

  console.log("Junk root archive (slugs '1'/'2'):");
  for (const j of report.junk) {
    const deps = j.deps
      ? ` [services=${j.deps.services} providerLinks=${j.deps.providerLinks} children=${j.deps.children}]`
      : "";
    console.log(`  - slug "${j.slug}": ${labelFor(j.action, report.applied)}${deps}`);
  }

  const blocked = report.junk.filter((j) => j.action === "blocked");
  if (blocked.length > 0) {
    console.log(
      `\n⚠ ${blocked.length} junk category(ies) NOT archived — they have real dependencies ` +
        "(see counts above). Left untouched for manual review; nothing was deleted."
    );
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
  } else {
    console.log(
      "\nApplied inside idempotent insert-if-absent semantics — re-running converges to the " +
        "same state and never overwrites an admin-edited category."
    );
  }
}

main()
  .catch((error) => {
    console.error("bootstrap-staging-taxonomy failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    // May be undefined if a guard rejected before the client was built.
    if (prisma) await prisma.$disconnect();
  });
