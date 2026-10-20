---
name: barq-preflight
description: Read-only BARQ preflight before any non-trivial task — authoritative branch / HEAD / remote / deployed state, clean tree, drift, migrations, health, and the task's scope boundary. Changes nothing.
argument-hint: "[task summary]"
allowed-tools: Bash(git status *) Bash(git log *) Bash(git rev-parse *) Bash(git ls-remote *) Bash(git fetch *) Bash(git rev-list *) Bash(node scripts/engineering/*) Bash(npx prisma validate) Read Grep Glob
---

# BARQ preflight (read-only)

Task: $ARGUMENTS

Run each step, record the exact command and exit code, and STOP at the first failed gate (report it; do not "fix" anything during preflight).

1. **Repository state** — `git fetch -q origin`, then report: current branch (`git branch --show-current`), HEAD (`git rev-parse --short HEAD`), `git status --porcelain` (must be empty unless the user's own uncommitted work is present — never discard it; report it), and `git ls-remote origin refs/heads/staging refs/heads/main`.
2. **Drift** — `git rev-list --left-right --count origin/staging...HEAD` (ahead / behind). Behind > 0 = remote drift: stop and report.
3. **Deployed staging** — `node scripts/engineering/verify-deploy.mjs --project barq-staging` (read-only). Record deployment id, built-from commit, migrations found / result, health. Never assume the last push deployed.
4. **Schema** — `npx prisma validate`; `node scripts/engineering/check-migrations.mjs`; count `prisma/migrations/*/` folders.
5. **Source of truth** — read `docs/project-memory/01-CURRENT-STATE.md` (the relevant rows) and `13-OPEN-QUESTIONS.md` for anything touching this task. Prefer the code over a doc's claim.
6. **Scope boundary** — write: in scope (files / areas), explicitly out of scope, sensitive areas touched (schema, migration, auth, payment, booking, pricing, rental-calendar, registration-reading, provider-documents, CI, deploy-config — see `scripts/engineering/scope-check.mjs`), required approvals (migration, production, external service), and the validation plan.
7. **Report** — a short table: check · result · exit code. Then the plan, and WAIT for explicit approval before implementing (CLAUDE.md workflow).

Never print environment values, tokens or secrets. Never sign in with the owner's account. Production (`barq`) is inspection-only here.
