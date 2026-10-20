#!/usr/bin/env node
// BARQ PreToolUse guard for shell commands (Bash and PowerShell tools).
//
// Exit 2 BLOCKS the command before any permission rule is consulted (an allow rule cannot override
// it) and the stderr text is shown to Claude as the reason. Exit 0 lets the normal permission rules
// decide (the committed .claude/settings.json makes push / deploy / migrate / env ASK for approval).
//
// Three tiers:
//   1. never   — irreversible, secret-exposing or production-touching commands: always blocked.
//   2. commit  — `git commit` runs the staged-change gates (diff --check, secret scan, scope check).
//   3. push    — `git push` runs scripts/engineering/prepush-check.mjs (branch, clean tree, drift).
// The guard is a seatbelt, not a sandbox: a command hidden inside a script file is not inspected,
// which is why CI repeats the secret / scope / migration checks on every PR.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_DELETE_TARGETS = /^(?:"|')?(?:\.\/)?(?:\.next|out|coverage|\.turbo|node_modules\/\.cache|test-results|playwright-report)(?:\/.*)?(?:"|')?$|scratchpad|(?:^|[\\/"'])(?:tmp-|_tmp)[^\\/"']*[\\/]?["']?$|[\\/]tmp[\\/]|\/tmp\b|\$TEMP|\$TMPDIR|AppData[\\/]Local[\\/]Temp|devtools[\\/]tmp/i;
const SECRET_NAME = /(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|DATABASE_URL|DIRECT_URL|AUTH_TOKEN|CREDENTIAL)/i;

/** Split a compound shell command into its simple segments. */
export function segments(command) {
  return command
    .split(/&&|\|\||;|\||\n|\$\(|`/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns { action: "block", reason } | { action: "commit" } | { action: "push", target } | { action: "pass" }. */
export function decide(command) {
  const c = command.replace(/\s+/g, " ").trim();
  const block = (reason) => ({ action: "block", reason });

  if (/--dangerously-skip-permissions\b/.test(c)) return block("--dangerously-skip-permissions is prohibited for BARQ work.");
  if (/(?:^|\s)--no-verify\b/.test(c) && /\bgit\b/.test(c)) return block("--no-verify bypasses the repository's checks — prohibited.");

  for (const s of segments(c)) {
    // ── git: history and working-tree destruction ─────────────────────────────────────────────
    if (/^git\b/.test(s)) {
      if (/^git (?:-c \S+ )*push\b/.test(s)) {
        if (/(?:\s|^)(?:--force(?:-with-lease)?|-f|--mirror|--delete|-d|--prune)\b/.test(s) || /\s\+\S+/.test(s) || /\s:\S+/.test(s)) return block("Force, mirror and deleting pushes are prohibited. Fix forward with a new commit.");
        if (/(?:\s|:)(?:main|master|production)(?:\s|$)/.test(s) || /:refs\/heads\/(?:main|master|production)\b/.test(s)) return block("Pushing to main/master is prohibited for agents — production releases go through the protected, owner-approved workflow (docs/project-memory/24-RELEASE-AND-ROLLBACK-RUNBOOK.md).");
        const target = s.match(/:(?:refs\/heads\/)?([\w./-]+)\s*$/)?.[1] ?? s.match(/^git push \S+ ([\w./-]+)\s*$/)?.[1] ?? null;
        return { action: "push", target };
      }
      if (/^git reset\b.*--hard\b/.test(s)) return block("git reset --hard discards work — prohibited. Use a new commit or `git stash` after asking.");
      if (/^git clean\b.*-[a-z]*f/.test(s)) return block("git clean -f deletes untracked files — prohibited.");
      if (/^git (?:checkout|restore)\b.*(?:\s--\s*\.|\s\.$|\s\.\s)/.test(s) || /^git checkout -- \S/.test(s)) return block("Discarding working-tree changes is prohibited — the user's changes must be preserved.");
      if (/^git restore\b(?!.*--staged)/.test(s) && !/--source/.test(s) && /\s\S+$/.test(s)) return block("`git restore <path>` discards uncommitted changes — ask the user first.");
      if (/^git branch\b.*\s-D\b/.test(s)) return block("git branch -D force-deletes a branch — prohibited.");
      if (/^git stash (?:drop|clear)\b/.test(s)) return block("Dropping stashes destroys work — prohibited.");
      if (/^git commit\b.*--amend\b/.test(s)) return block("Amending commits is prohibited — create a new commit.");
      if (/^git (?:filter-branch|filter-repo|update-ref -d|replace)\b/.test(s) || /^git rebase\b/.test(s)) return block("History rewriting (rebase / filter / update-ref -d) is prohibited.");
      if (/^git config\b.*(?:credential|--get-all|--list|-l\b)/.test(s)) return block("Reading git credential configuration is prohibited.");
      if (/^git commit\b/.test(s)) return { action: "commit" };
    }

    // ── Vercel: production, aliases and environment are owner-only ───────────────────────────
    if (/^(?:npx |pnpm dlx |bunx )?vercel\b/.test(s)) {
      if (/\s--prod\b|--target[= ]production\b/.test(s)) return block("Production deployment is owner-only (explicit approval in the same task + the protected workflow).");
      if (/^(?:\S+ )?vercel (?:promote|rollback|alias|redeploy|remove|rm|domains|dns|certs|project (?:rm|remove)|git disconnect|link)\b/.test(s)) return block("Promote / rollback / alias / redeploy / remove / domain / link changes are owner-only.");
      if (/^(?:\S+ )?vercel api\b/.test(s) && /\s(?:-X|--method)[= ]?(?!GET\b)\w+/i.test(s)) return block("`vercel api` is read-only for agents (GET only).");
      if (/^(?:\S+ )?vercel env\b/.test(s)) return block("`vercel env` is prohibited for agents (never pull, print, add or remove environment values).");
      if (/^(?:\S+ )?vercel (?:deploy\b|--)/.test(s) || /^(?:npx )?vercel$/.test(s)) return block("Agents do not deploy from the CLI — staging deploys only from a push to `staging` (Git integration).");
    }

    // ── secrets and environment values ────────────────────────────────────────────────────────
    if ((/^(?:printenv|env|export -p|declare -x|compgen -v)(?:\s|$)/.test(s) || /^set$/.test(s)) && !/^env \w+=\S* \S/.test(s)) return block("Printing environment variables is prohibited.");
    if (/(?:^|\s)(?:cat|type|less|more|head|tail|bat|nl|od|xxd|strings|grep|rg|findstr|sed|awk|Get-Content|gc|code)\b[^|]*(?:^|[\s/\\"'])\.env(?!\.example)(?:\.[\w.-]+)?(?:["'\s]|$)/.test(s)) return block("Reading .env files is prohibited (use `node -e` checks that print only SET / EMPTY, never values).");
    if (/\b(?:echo|printf|Write-Output|Write-Host)\b[^|]*\$(?:\{)?(?:env:)?\w*/.test(s) && SECRET_NAME.test(s)) return block("Printing a secret-bearing variable is prohibited.");
    if (/^gh (?:secret|auth token|auth refresh|variable set)\b/.test(s)) return block("GitHub secrets / tokens are owner-only.");
    if (/Get-ChildItem\s+env:|\[Environment\]::GetEnvironmentVariables/i.test(s)) return block("Printing environment variables is prohibited.");

    // ── broad recursive deletion ──────────────────────────────────────────────────────────────
    const rm = s.match(/^(?:sudo )?rm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?:\s+-[a-zA-Z]+)*\s+(.+)$/) ?? s.match(/^Remove-Item\b(?=.*-Recurse)(.*)$/i);
    if (rm) {
      const targets = (rm[2] ?? rm[1]).split(/\s+/).filter((t) => t && !t.startsWith("-")); // drop flag TOKENS only (paths may contain hyphens)
      if (targets.length === 0 || targets.some((t) => !ALLOWED_DELETE_TARGETS.test(t) || /^(?:\/|~|\.|\.\.|\*|"?\.\/?"?)$/.test(t))) return block(`Recursive deletion is limited to build/cache/scratch folders; refused: ${targets.join(" ")}`);
    }

    // ── database: no resets, no data-loss pushes, no direct deletes ──────────────────────────
    if (/prisma\s+migrate\s+reset\b|--force-reset\b|--accept-data-loss\b/.test(s)) return block("Database reset / data-loss flags are prohibited.");
    if (/\b(?:psql|pg_dump|pg_restore|prisma db execute)\b/.test(s) && /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|DATABASE|SCHEMA))\b/i.test(c)) return block("Direct database deletion is prohibited — use the domain's supported operations.");
    if (/^(?:node|npx tsx|tsx)\b.*\s-e\b/.test(s) && /\.(?:deleteMany|delete)\(|\$executeRaw(?:Unsafe)?[`(][^`)]*\b(?:DELETE|TRUNCATE|DROP)\b/i.test(c)) return block("Inline scripts that delete database rows are prohibited — use supported domain operations.");
  }
  return { action: "pass" };
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // not a tool call we understand — let normal permissions decide
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) process.exit(0);
  const d = decide(command);
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const script = (n) => path.join(root, "scripts", "engineering", n);
  if (d.action === "block") {
    process.stderr.write(`BARQ guard: ${d.reason}\n`);
    process.exit(2);
  }
  if (d.action === "commit") {
    const checks = [
      ["git", ["diff", "--cached", "--check"], "git diff --cached --check"],
      [process.execPath, [script("secret-scan.mjs"), "--staged"], "secret-scan --staged"],
      [process.execPath, [script("scope-check.mjs"), "--staged"], "scope-check --staged"],
    ];
    const failed = [];
    for (const [cmd, args, label] of checks) {
      const r = run(cmd, args);
      if (r.code !== 0) failed.push(`${label} (exit ${r.code}):\n${r.out}`);
    }
    if (failed.length) {
      process.stderr.write(`BARQ guard: commit blocked — pre-commit checks failed.\n${failed.join("\n\n")}\n`);
      process.exit(2);
    }
    process.exit(0);
  }
  if (d.action === "push") {
    const r = run(process.execPath, [script("prepush-check.mjs"), ...(d.target ? ["--target", d.target] : [])]);
    if (r.code !== 0) {
      process.stderr.write(`BARQ guard: push blocked — pre-push check failed.\n${r.out}\n`);
      process.exit(2);
    }
    process.stderr.write(`${r.out}\n`);
    process.exit(0);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) main();
