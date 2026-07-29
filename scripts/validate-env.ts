import { readFileSync, existsSync } from "node:fs";
import { envSchema } from "./env-schema";

// Environment validation — Phase C.1 (Infrastructure & Quality).
//
// Runs before `dev`/`build` (wired via package.json's `predev`/`prebuild`
// hooks) so a missing or malformed required variable fails fast with a
// clear message, instead of surfacing later as an opaque runtime error
// inside Better Auth or Prisma. Only variables actually read via
// `process.env` in src/ are required here (confirmed by repo-wide
// search) — see .env.example for the full documented set, including
// ones not yet consumed by any code path.
//
// Loads .env itself (a minimal, single-line KEY=VALUE parser — matching
// this project's own .env/.env.example format, nothing more elaborate)
// rather than relying on Node's `--env-file` flag: that flag needs
// Node 20.6+, and `--env-file-if-exists` (needed so this doesn't hard
// -fail in CI, where real vars come from injected process env, not a
// committed .env file) needs Node 22.9+ — both newer than this
// project's declared `engines.node: >=20.0.0`. Existing values already
// in `process.env` (e.g. CI secrets) take precedence over anything
// parsed from .env.
function loadDotEnvIfPresent(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, e.g. KEY="value"
    // or KEY='value' — this project's own .env quotes its values this
    // way; a bare KEY=value (no quotes) is also accepted as-is.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent(".env");

// Phase D.3 (Production Hardening) — the schema itself now lives in
// ./env-schema.ts, specifically so it's unit-testable in isolation
// (scripts/env-schema.test.ts) without invoking this file's own side
// effects (reading .env from disk, calling process.exit()). See that
// file's own comment for the production-only-checks/CI-safety
// reasoning.

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Environment validation failed:\n");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nSee .env.example for the full list of required variables.");
  process.exit(1);
}

console.log("Environment variables validated.");
