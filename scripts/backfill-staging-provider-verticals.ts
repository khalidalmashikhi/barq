import { PrismaClient } from "@prisma/client";
import {
  assertStagingEnvironment,
  assertStagingDatabaseTarget,
  StagingGuardError,
  StagingDatabaseTargetError,
} from "../src/lib/categories/staging-taxonomy-bootstrap";
import { runProviderVerticalBackfill, type BackfillPrisma } from "../src/lib/provider/verticals/backfill";
import { TOURIST_GUIDE_CATEGORY_SLUG } from "../src/lib/tour-template/eligibility";

// The IMMUTABLE grandfathering cutover boundary — the migration-53 timestamp. A service created at
// or after this instant can NEVER be grandfathered by this backfill, no matter how often it runs.
const CUTOVER_AT = new Date("2026-09-10T12:00:00.000Z");

// Phase 3B — Phase 1. Provider-vertical BACKFILL — STAGING runner.
//
// A thin, env-guarded CLI wrapper around the pure core in
// src/lib/provider/verticals/backfill.ts. It reuses the SAME two guards as the taxonomy /
// verification / tour-template bootstraps (APP_ENV=staging AND DATABASE_URL points at the real
// staging Supabase pooler), is DRY-RUN by default (writes only with --apply), is ADDITIVE and
// IDEMPOTENT (a second run converges to the same state), NEVER auto-approves a vertical, and prints
// only non-sensitive counts/actions — never DATABASE_URL or any secret.
//
// It must be run AFTER migration 53 (20260910120000_provider_verticals) has been applied to the
// target database — it depends on Service.offeringKind / Service.legacyVerticalExempt and the
// provider_verticals table existing.
//
// USAGE (from an environment whose DATABASE_URL points at STAGING):
//   APP_ENV=staging npx tsx scripts/backfill-staging-provider-verticals.ts          # dry-run
//   APP_ENV=staging npx tsx scripts/backfill-staging-provider-verticals.ts --apply  # execute

let prisma: PrismaClient | undefined;

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

  console.log("=== BARQ provider-vertical backfill (staging) ===");
  console.log(`mode: ${mode}`);

  // Only now — after both guards pass — instantiate the client.
  prisma = new PrismaClient();

  // Resolve the verified tourist-guide category id from its stable slug (per-environment id). When
  // absent (an environment that never seeded the taxonomy) the TOUR segment is skipped, never guessed.
  const touristGuideCategory = await prisma.category.findUnique({
    where: { slug: TOURIST_GUIDE_CATEGORY_SLUG },
    select: { id: true },
  });

  const report = await runProviderVerticalBackfill(prisma as unknown as BackfillPrisma, {
    apply,
    cutoverAt: CUTOVER_AT,
    touristGuideCategoryId: touristGuideCategory?.id ?? null,
  });

  const line = (label: string, n: number) => console.log(`    - ${label.padEnd(38)} ${n}`);
  console.log(`\nCutover boundary (immutable): ${report.cutoverAt}`);
  console.log("Plan / result (counts only — no personal data):");
  for (const seg of report.segments) {
    console.log(`\n  ${seg.vertical} (${seg.offeringKind}):`);
    line("services classified", seg.offeringKindClassified);
    line("pre-cutover PUBLISHED grandfathered", seg.legacyExemptGrandfathered);
    line("providers operating a listing", seg.providersWithListings);
    line("PENDING_REVIEW candidates created", seg.candidateVerticalsCreated);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
  } else {
    console.log(
      "\nApplied. Additive + idempotent — re-running converges to the same state. Candidate " +
        "verticals are PENDING_REVIEW and must be reviewed by an admin; nothing was auto-approved."
    );
  }
}

main()
  .catch((error) => {
    console.error("backfill-staging-provider-verticals failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
