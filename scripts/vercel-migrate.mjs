// Vercel build step: apply database migrations (`prisma migrate deploy`) — EXCEPT on Preview deployments.
//
// Invoked by package.json "vercel-build" between `validate-env` and `next build`.
//
// WHY (incident 2026-11-14): opening PR #21 triggered a barq-staging PREVIEW deployment whose build ran
// `prisma migrate deploy` and applied an unmerged migration to the SHARED staging database before review.
// A Preview build shares its environment's DATABASE_URL, so it must never migrate.
//
// RULE: skip ONLY when Vercel reports VERCEL_ENV=preview (exact value, as Vercel sets it). Every other
// value — production (the `staging` branch of barq-staging and `main` of barq), development, anything
// unexpected, or unset (local / CI) — keeps the previous behaviour and runs `prisma migrate deploy`.
// Only the migration step is affected: environment validation and `next build` still run on Preview.
// A failed migration still fails the build (its exit code is propagated).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATE_ARGS = ["migrate", "deploy"];

/** Pure decision: should this build run `prisma migrate deploy`? */
export function migrationDecision(env) {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv === "preview") {
    return {
      run: false,
      message:
        "vercel-migrate: SKIPPED `prisma migrate deploy` — database migrations are intentionally not run because VERCEL_ENV=preview " +
        "(Preview deployments must never migrate a shared database; migrations run only on production-target deployments).",
    };
  }
  const shown = vercelEnv === undefined || vercelEnv === "" ? "<unset>" : vercelEnv;
  return { run: true, message: `vercel-migrate: running \`prisma migrate deploy\` (VERCEL_ENV=${shown}).` };
}

/** Logs the decision and runs Prisma when required. Returns the process exit code. */
export function runVercelMigrations({ env = process.env, runPrisma = runPrismaCli, log = console.log } = {}) {
  const decision = migrationDecision(env);
  log(decision.message);
  if (!decision.run) return 0;
  return runPrisma(MIGRATE_ARGS);
}

// The project's own Prisma CLI (the same binary `prisma` resolves to in npm scripts), run with the current
// Node executable — no shell, so it behaves identically on Linux (Vercel), macOS and Windows.
function runPrismaCli(args) {
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(`vercel-migrate: could not start the Prisma CLI: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.exit(runVercelMigrations());
}
