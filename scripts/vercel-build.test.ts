import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import packageJson from "../package.json";
// @ts-expect-error — plain .mjs build helper (no type declarations), same convention as the engineering guards
import { migrationDecision, runVercelMigrations, MIGRATE_ARGS } from "./vercel-migrate.mjs";

// Production Blocker fix — regression test for a real deployment-pipeline
// gap: npm's automatic `pre<name>`/`post<name>` lifecycle hooks only fire
// for the EXACT invoked script name. `predev`/`prebuild` (which both run
// `npm run validate-env`) therefore never fire when Vercel's build system
// invokes the custom-named `vercel-build` script directly — meaning the
// entire production environment-safety schema (CRON_SECRET presence,
// BETTER_AUTH_SECRET length, OTP_PROVIDER≠console, NEXT_PUBLIC_APP_URL
// presence — all enforced by scripts/env-schema.ts) could previously ship
// to production completely unchecked.
//
// Fixed by making `vercel-build` call `validate-env` explicitly as its own
// first step, rather than relying on npm's lifecycle-hook naming
// convention at all. This test guards against a future edit silently
// dropping that call again (e.g. during an unrelated build-script tweak).

describe("package.json vercel-build script", () => {
  it("runs validate-env as part of vercel-build, not only via the prebuild hook", () => {
    const script = packageJson.scripts["vercel-build"];
    expect(script).toContain("npm run validate-env");
  });

  it("runs validate-env before the database migration step and the build itself", () => {
    const script = packageJson.scripts["vercel-build"];
    const validateEnvIndex = script.indexOf("npm run validate-env");
    const migrateIndex = script.indexOf("node scripts/vercel-migrate.mjs");
    const buildIndex = script.indexOf("next build");

    expect(validateEnvIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThan(validateEnvIndex);
    expect(buildIndex).toBeGreaterThan(migrateIndex);
  });

  // 2026-11-14 incident: a barq-staging PREVIEW deployment of an unmerged PR ran `prisma migrate deploy`
  // against the shared staging database. Every migration now goes through scripts/vercel-migrate.mjs,
  // which skips ONLY on VERCEL_ENV=preview; a direct call would silently bring the bypass back.
  it("never calls `prisma migrate deploy` directly — the preview-aware helper is the only migration path", () => {
    expect(packageJson.scripts["vercel-build"]).not.toMatch(/prisma\s+migrate\s+deploy/);
  });
});

describe("scripts/vercel-migrate.mjs — Preview deployments never migrate the database", () => {
  it("skips the migration ONLY when VERCEL_ENV=preview", () => {
    const d = migrationDecision({ VERCEL_ENV: "preview" });
    expect(d.run).toBe(false);
    expect(d.message).toMatch(/skipped/i);
    expect(d.message).toContain("VERCEL_ENV=preview");
  });

  it("keeps today's behaviour (migrate) for production, development, other values and an unset VERCEL_ENV", () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "" }, { VERCEL_ENV: "Preview" }, {}]) {
      expect(migrationDecision(env).run, JSON.stringify(env)).toBe(true);
    }
    expect(MIGRATE_ARGS).toEqual(["migrate", "deploy"]);
  });

  it("preview: logs the skip and never invokes Prisma; the step succeeds so validate-env → next build continues", () => {
    const runPrisma = vi.fn(() => 0);
    const log = vi.fn();
    expect(runVercelMigrations({ env: { VERCEL_ENV: "preview" }, runPrisma, log })).toBe(0);
    expect(runPrisma).not.toHaveBeenCalled();
    expect(log.mock.calls.join("\n")).toMatch(/skipped[\s\S]*VERCEL_ENV=preview/i);
  });

  it("production / unset: invokes `prisma migrate deploy` exactly once and propagates its exit code", () => {
    for (const env of [{ VERCEL_ENV: "production" }, {}]) {
      const ok = vi.fn(() => 0);
      expect(runVercelMigrations({ env, runPrisma: ok, log: () => {} })).toBe(0);
      expect(ok).toHaveBeenCalledTimes(1);
      expect(ok).toHaveBeenCalledWith(["migrate", "deploy"]);
      const failing = vi.fn(() => 1);
      expect(runVercelMigrations({ env, runPrisma: failing, log: () => {} })).toBe(1); // a failed migration still fails the build
    }
  });

  it("as a process: preview exits 0 without touching the database; production really runs Prisma (unreachable DB → it fails)", () => {
    const script = path.join(process.cwd(), "scripts/vercel-migrate.mjs");
    // a closed local port: any real connection attempt fails, so success proves Prisma was never invoked
    const unreachable = "postgresql://nobody:nothing@127.0.0.1:1/none";
    const run = (VERCEL_ENV?: string) =>
      spawnSync(process.execPath, [script], {
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, VERCEL_ENV, DATABASE_URL: unreachable, DIRECT_URL: unreachable },
      });
    const preview = run("preview");
    expect(preview.status).toBe(0);
    expect(preview.stdout).toMatch(/skipped[\s\S]*VERCEL_ENV=preview/i);
    expect(preview.stdout + preview.stderr).not.toMatch(/Datasource|P1001|migrations? found/);

    const production = run("production");
    expect(production.status).not.toBe(0);
    expect(production.stdout + production.stderr).toMatch(/Datasource|P1001|Can't reach database server/);
  }, 150_000);
});
