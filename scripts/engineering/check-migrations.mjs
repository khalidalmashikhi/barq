#!/usr/bin/env node
// BARQ migration-file integrity.
//
//   node scripts/engineering/check-migrations.mjs                    (working tree vs HEAD + layout)
//   node scripts/engineering/check-migrations.mjs --base origin/staging   (CI: the PR's changes)
//
// FAILS when:
//   - an EXISTING migration is modified, renamed or deleted (applied history is immutable — fix
//     forward with a new migration);
//   - a migration folder is not `<14-digit timestamp>_<snake_name>` with exactly `migration.sql`;
//   - a new migration sorts BEFORE an existing one (it would apply out of order on a fresh DB);
//   - `migration_lock.toml`'s provider changes.
// WARNS (review required, not a failure) when a NEW migration contains a statement that a code
// rollback cannot undo: DROP, column type change, RENAME, DELETE / UPDATE / TRUNCATE (data rewrite).
// It never connects to a database and never runs a migration.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { changedFiles, git, isMain, parseArgs, report, tryGit } from "./lib.mjs";

const DIR = "prisma/migrations";
const NAME = /^\d{14}_[a-z0-9_]+$/;
const DESTRUCTIVE = [
  { id: "DROP", re: /\bDROP\s+(?:TABLE|COLUMN|INDEX|TYPE|CONSTRAINT|SCHEMA|VIEW)\b/i },
  { id: "TYPE CHANGE", re: /\bALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b/i },
  { id: "RENAME", re: /\bRENAME\b/i },
  { id: "DATA REWRITE", re: /^\s*(?:DELETE\s+FROM\b|UPDATE\s+"?[\w.]+"?\s+SET\b|TRUNCATE\b)/im },
];

export function destructiveStatements(sql) {
  const body = sql.replace(/--.*$/gm, "");
  return DESTRUCTIVE.filter((d) => d.re.test(body)).map((d) => d.id);
}

export function checkLayout(root = ".") {
  const failures = [];
  const dir = path.join(root, DIR);
  if (!existsSync(dir)) return { failures: [`${DIR} does not exist`], names: [] };
  const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const n of names) {
    if (!NAME.test(n)) failures.push(`${DIR}/${n} — folder name must be <YYYYMMDDHHMMSS>_<snake_name>`);
    const files = readdirSync(path.join(dir, n));
    if (!files.includes("migration.sql")) failures.push(`${DIR}/${n} — missing migration.sql`);
    const extra = files.filter((f) => f !== "migration.sql");
    if (extra.length) failures.push(`${DIR}/${n} — unexpected file(s): ${extra.join(", ")}`);
  }
  if (!existsSync(path.join(dir, "migration_lock.toml"))) failures.push(`${DIR}/migration_lock.toml is missing`);
  return { failures, names };
}

export function checkChanges(changes, baseNames) {
  const failures = [];
  const warnings = [];
  const added = new Set();
  for (const c of changes) {
    if (!c.path.startsWith(`${DIR}/`)) continue;
    const rel = c.path.slice(DIR.length + 1);
    if (rel === "migration_lock.toml") {
      if (c.status !== "A") failures.push(`${c.path} — the migration lock must not change (provider switch is an ADR decision)`);
      continue;
    }
    const folder = rel.split("/")[0];
    if (c.status === "A" && !baseNames.has(folder)) {
      added.add(folder);
      continue;
    }
    failures.push(`${c.path} — existing migration ${c.status === "D" ? "deleted" : "modified"}; applied history is immutable (add a new migration instead)`);
  }
  const latestBase = [...baseNames].sort().at(-1);
  for (const f of [...added].sort()) if (latestBase && f < latestBase) failures.push(`${DIR}/${f} — sorts before the existing ${latestBase}; it would apply out of order`);
  return { failures, warnings, added: [...added].sort() };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const layout = checkLayout();
    const base = typeof args.base === "string" ? args.base : "HEAD";
    const diffArgs = typeof args.base === "string" ? [`${args.base}...HEAD`] : ["HEAD"];
    const baseCommit = typeof args.base === "string" ? git(["merge-base", args.base, "HEAD"]) : "HEAD";
    // a base without prisma/migrations (first migration ever) simply has no existing migrations
    const baseList = tryGit(["ls-tree", "-d", "--name-only", `${baseCommit}:${DIR}`]);
    const baseNames = new Set(baseList.ok ? baseList.out.split("\n").filter(Boolean) : []);
    const changes = changedFiles(diffArgs);
    // untracked new migration folders in the working tree (local use)
    if (!args.base) for (const n of layout.names) if (!baseNames.has(n)) changes.push({ status: "A", path: `${DIR}/${n}/migration.sql` });
    const unique = [...new Map(changes.map((c) => [c.path, c])).values()];
    const result = checkChanges(unique, baseNames);
    for (const f of result.added) {
      const kinds = destructiveStatements(readFileSync(path.join(DIR, f, "migration.sql"), "utf8"));
      if (kinds.length) result.warnings.push(`${DIR}/${f} — contains ${kinds.join(", ")}: NOT reversible by a code rollback; needs an explicit migration-safety review + backup point before deploy`);
    }
    console.log(`check-migrations vs ${base}: ${layout.names.length} migration folder(s), ${result.added.length} new`);
    process.exit(report("check-migrations", [...layout.failures, ...result.failures], result.warnings));
  } catch (e) {
    console.error(`check-migrations: ${e.message}`);
    process.exit(2);
  }
}
