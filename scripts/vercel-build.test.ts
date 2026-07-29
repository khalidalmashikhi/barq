import { describe, it, expect } from "vitest";
import packageJson from "../package.json";

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

  it("runs validate-env before the database migration and the build itself", () => {
    const script = packageJson.scripts["vercel-build"];
    const validateEnvIndex = script.indexOf("npm run validate-env");
    const migrateIndex = script.indexOf("prisma migrate deploy");
    const buildIndex = script.indexOf("next build");

    expect(validateEnvIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThan(validateEnvIndex);
    expect(buildIndex).toBeGreaterThan(validateEnvIndex);
  });
});
