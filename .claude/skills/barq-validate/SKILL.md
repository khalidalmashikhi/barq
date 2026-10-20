---
name: barq-validate
description: Run the full BARQ validation suite on the current HEAD, each gate separately (never the full suite and the build at the same time), and report exact totals and exit codes.
argument-hint: "[--base <ref>] (default origin/staging)"
allowed-tools: Bash(git *) Bash(npm run typecheck) Bash(npm run lint) Bash(npm run test) Bash(npm run build) Bash(npx tsc --noEmit *) Bash(npx eslint *) Bash(npx vitest run *) Bash(npx prisma validate) Bash(node scripts/engineering/*)
---

# BARQ validation

Base for range checks: `$ARGUMENTS` if given, else `origin/staging`. Record every command, exit code and total. A failure STOPS the sequence — report it with its output; do not continue to later gates and do not claim success.

Run in this order, one at a time:

| # | Gate | Command |
|---|------|---------|
| 1 | whitespace | `git diff --check <base>...HEAD` (and `git diff --check` for uncommitted work) |
| 2 | prohibited scope | `node scripts/engineering/scope-check.mjs --base <base>` (add `--forbid <areas>` from the task's hard stop) |
| 3 | secrets | `node scripts/engineering/secret-scan.mjs --base <base>` (every commit) and `--staged` if anything is staged |
| 4 | migrations | `node scripts/engineering/check-migrations.mjs --base <base>` |
| 5 | translations | `node scripts/engineering/translation-parity.mjs` |
| 6 | types | `npm run typecheck` |
| 7 | lint (touched) | `npx eslint <changed .ts/.tsx files from git diff --name-only --diff-filter=AM <base>...HEAD>` |
| 8 | schema | `npx prisma validate` |
| 9 | focused tests | `npx vitest run --changed <base> --passWithNoTests`, plus the suites the task names |
| 10 | full suite | `npm run test` — ALONE (record files / passed / skipped / failed) |
| 11 | build | `npm run build` — ALONE, after the suite finished |
| 12 | bundle | `node scripts/engineering/bundle-scan.mjs` (after the build) |

Report a table: gate · command · exit code · totals. A pre-existing failure unrelated to the change is still a failure — report it plainly and say why it is unrelated, with evidence. Never weaken a check, skip a test, or edit a guard to make a gate pass.
