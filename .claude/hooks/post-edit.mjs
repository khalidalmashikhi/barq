#!/usr/bin/env node
// BARQ PostToolUse check after Edit / Write — fast, scoped, never the full suite.
//
//   messages/<locale>/<ns>.json  → translation parity for THAT namespace across the 8 locales
//   prisma/schema.prisma         → `prisma validate` + migration-file integrity
//   prisma/migrations/**         → migration-file integrity (applied migrations are immutable)
//
// Exit 2 surfaces the problem to Claude (the edit already happened; nothing is blocked). While a
// multi-locale edit is in progress a parity gap is expected — it must be closed before committing.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const file = String(input?.tool_input?.file_path ?? "").replace(/\\/g, "/");
if (!file) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rel = path.relative(root, file).replace(/\\/g, "/");
const script = (n) => path.join(root, "scripts", "engineering", n);
const run = (cmd, args, shell = false) => {
  const r = shell ? spawnSync([cmd, ...args].join(" "), { cwd: root, encoding: "utf8", shell: true, timeout: 60_000 }) : spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

const problems = [];
if (/^messages\/[a-z]{2}\/[^/]+\.json$/.test(rel)) {
  const r = run(process.execPath, [script("translation-parity.mjs"), rel]);
  if (r.code !== 0) problems.push(`translation parity (exit ${r.code}) — close the gap in every locale before committing:\n${r.out}`);
}
if (rel === "prisma/schema.prisma") {
  const r = run("npx", ["prisma", "validate"], process.platform === "win32");
  if (r.code !== 0) problems.push(`prisma validate (exit ${r.code}):\n${r.out.split("\n").slice(-12).join("\n")}`);
}
if (rel === "prisma/schema.prisma" || rel.startsWith("prisma/migrations/")) {
  const r = run(process.execPath, [script("check-migrations.mjs")]);
  if (r.code !== 0) problems.push(`migration integrity (exit ${r.code}):\n${r.out}`);
  else if (/\bwarn\b/.test(r.out)) problems.push(`migration review needed:\n${r.out}`);
}
if (problems.length) {
  process.stderr.write(`BARQ post-edit check for ${rel}:\n${problems.join("\n\n")}\n`);
  process.exit(2);
}
process.exit(0);
