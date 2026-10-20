// Shared helpers for the BARQ engineering guard scripts (scripts/engineering/*.mjs).
//
// Plain Node (>= 20), no dependencies, so the same checks run locally, from Claude Code hooks and in
// CI. Every helper is READ-ONLY: it inspects git state and files, never writes, never prints an
// environment value, never contacts a network host except through an explicit `git fetch` the
// caller asked for.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** True when the calling module is the script being run (not imported by another script/test). */
export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(process.argv[1]);
}

export function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", opts.quiet ? "ignore" : "pipe"], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

export function tryGit(args) {
  try {
    return { ok: true, out: git(args, { quiet: true }) };
  } catch (error) {
    return { ok: false, out: "", error };
  }
}

/** Parse `--name value` / `--flag` arguments. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

/**
 * The change set to inspect:
 *   --staged            the index (pre-commit)
 *   --range A..B        an explicit commit range (pre-push / CI)
 *   --base REF          REF...HEAD (merge-base; PR CI)
 * Returns { label, diffArgs } where diffArgs are passed to `git diff`.
 */
export function resolveChangeSet(args) {
  if (args.staged) return { label: "staged changes", diffArgs: ["--cached"] };
  if (typeof args.range === "string") return { label: `range ${args.range}`, diffArgs: [args.range] };
  if (typeof args.base === "string") return { label: `${args.base}...HEAD`, diffArgs: [`${args.base}...HEAD`] };
  throw new Error("specify --staged, --range A..B or --base REF");
}

/** Changed files with status: [{ status: "A"|"M"|"D"|"R..", path, from? }]. */
export function changedFiles(diffArgs) {
  const out = git(["diff", "--name-status", "--no-renames", ...diffArgs]);
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [status, path] = line.split("\t");
    return { status: status[0], path };
  });
}

/** Added lines per file (unified=0), excluding deleted files. [{ path, line, text }] */
export function addedLines(diffArgs) {
  const out = git(["diff", "--unified=0", "--no-color", "--no-renames", ...diffArgs]);
  const rows = [];
  let file = null;
  let lineNo = 0;
  for (const raw of out.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.replace(/^\+\+\+ b\//, "");
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (file && raw.startsWith("+") && !raw.startsWith("+++")) {
      rows.push({ path: file, line: lineNo, text: raw.slice(1) });
      lineNo++;
    }
  }
  return rows;
}

export function report(title, failures, warnings = []) {
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(failures.length === 0 ? `${title}: OK${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : ""}` : `${title}: FAILED (${failures.length})`);
  return failures.length === 0 ? 0 : 1;
}
