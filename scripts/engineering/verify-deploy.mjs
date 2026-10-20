#!/usr/bin/env node
// BARQ post-deploy verification — READ-ONLY. Never deploys, promotes, aliases or changes env.
//
//   node scripts/engineering/verify-deploy.mjs --project barq-staging --expect <sha>
//   node scripts/engineering/verify-deploy.mjs --project barq --expect <sha>   (production: inspect only)
//
// Proves, for the deployment the project's public alias serves RIGHT NOW:
//   1. deployment id, target and status (must be Ready, target production-of-that-project);
//   2. the commit it was built from (from the build log "Cloning … Commit: <sha>") equals --expect;
//   3. the migration result from the same log ("N migrations found", "No pending migrations" /
//      "applied") — the build runs `prisma migrate deploy`; this script never does;
//   4. GET /api/health: status, database, environment ok; reports otpProvider / paymentProvider so
//      the caller can confirm they are UNCHANGED.
// Requires an authenticated Vercel CLI (`vercel whoami`). Prints no environment value.

import { spawnSync } from "node:child_process";
import { isMain, parseArgs, report } from "./lib.mjs";

export const PROJECTS = {
  "barq-staging": { alias: "barq-staging.vercel.app", label: "STAGING" },
  barq: { alias: "barq-barq4.vercel.app", label: "PRODUCTION (read-only inspection)" },
};

function vercel(args) {
  // npx is a .cmd shim on Windows; arguments are fixed strings validated below (no user text).
  const r =
    process.platform === "win32"
      ? spawnSync(`npx vercel ${args.join(" ")}`, { encoding: "utf8", shell: true, timeout: 180_000 })
      : spawnSync("npx", ["vercel", ...args], { encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

export function parseInspect(text) {
  const field = (name) => text.match(new RegExp(`^\\s*${name}\\s+(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { id: field("id"), target: field("target"), status: field("status")?.replace(/^●\s*/, "") ?? null, url: field("url") };
}

export function parseBuildLog(text) {
  const sha = text.match(/Cloning [^\n]*\(Branch: ([^,]+), Commit: ([0-9a-f]{7,40})\)/);
  const found = text.match(/(\d+) migrations? found in prisma\/migrations/);
  const none = /No pending migrations to apply/.test(text);
  const applied = /All migrations have been successfully applied/.test(text);
  const failed = /Error: P\d{4}|migrate deploy[^\n]*failed|Migration [^\n]* failed/i.test(text);
  return { branch: sha?.[1] ?? null, sha: sha?.[2] ?? null, migrationsFound: found ? Number(found[1]) : null, migrationResult: failed ? "FAILED" : applied ? "APPLIED" : none ? "NONE_PENDING" : "NOT_FOUND_IN_LOG" };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const project = PROJECTS[args.project];
  if (!project) {
    console.error(`verify-deploy: --project must be one of ${Object.keys(PROJECTS).join(", ")}`);
    process.exit(2);
  }
  const expect = typeof args.expect === "string" ? args.expect : null;
  if (expect && !/^[0-9a-f]{7,40}$/.test(expect)) {
    console.error("verify-deploy: --expect must be a commit sha");
    process.exit(2);
  }
  const failures = [];
  console.log(`verify-deploy: ${project.label} — ${args.project} via ${project.alias}`);
  const insp = vercel(["inspect", project.alias]);
  const d = parseInspect(insp.out);
  console.log(`  deployment: ${d.id ?? "?"}  target=${d.target ?? "?"}  status=${d.status ?? "?"}  url=${d.url ?? "?"}`);
  if (insp.code !== 0 || !d.id) failures.push(`vercel inspect ${project.alias} failed (exit ${insp.code}) — the CLI is not authenticated, or no Ready deployment is behind this alias`);
  if (d.status && d.status !== "Ready") failures.push(`deployment status is ${d.status}, not Ready`);
  if (d.target && d.target !== "production") failures.push(`alias is served by a ${d.target} deployment, not the project's production target`);
  if (d.url && /^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(d.url)) {
    const logs = vercel(["inspect", d.url, "--logs"]);
    const b = parseBuildLog(logs.out);
    console.log(`  built from: branch=${b.branch ?? "?"} commit=${b.sha ?? "?"}`);
    console.log(`  migrations: found=${b.migrationsFound ?? "?"} result=${b.migrationResult}`);
    if (!b.sha) failures.push("commit not found in the build log");
    else if (expect && !(b.sha.startsWith(expect) || expect.startsWith(b.sha))) failures.push(`deployed commit ${b.sha} ≠ expected ${expect}`);
    if (b.migrationResult === "FAILED") failures.push("the build log reports a migration failure");
    if (args.project === "barq-staging" && b.migrationResult === "NOT_FOUND_IN_LOG") failures.push("no migration result in the staging build log (expected `prisma migrate deploy` output)");
  }
  try {
    const res = await fetch(`https://${project.alias}/api/health`, { signal: AbortSignal.timeout(30_000) });
    const h = await res.json().catch(() => {
      throw new Error(`HTTP ${res.status}, not the health JSON`);
    });
    console.log(`  health: http=${res.status} status=${h.status} database=${h.database} environment=${h.environment} otpProvider=${h.otpProvider} paymentProvider=${h.paymentProvider}`);
    for (const k of ["status", "database", "environment"]) if (h[k] !== "ok") failures.push(`/api/health ${k}=${h[k]}`);
  } catch (e) {
    failures.push(`/api/health unavailable (${e.message ?? e.name})`);
  }
  // exitCode (not process.exit): let the fetch socket close first — an abrupt exit trips a libuv
  // assertion on Windows and turns a pass into exit 127.
  process.exitCode = report("verify-deploy", failures);
}
