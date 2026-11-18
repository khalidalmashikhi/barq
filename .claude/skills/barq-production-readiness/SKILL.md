---
name: barq-production-readiness
description: Production READINESS ASSESSMENT for BARQ (barq / main) — evidence-based go / no-go report. Never deploys, merges to main, promotes or changes production configuration unless explicit production authorization is part of the same task.
argument-hint: "<candidate-sha>"
allowed-tools: Bash(git *) Bash(node scripts/engineering/*) Bash(npx vercel inspect *) Bash(npx vercel ls *) Bash(gh run list *) Bash(gh run view *) Bash(gh pr view *) Bash(gh pr checks *) Read Grep Glob
---

# BARQ production readiness (assessment only)

Candidate: `$ARGUMENTS`. This produces a report. It does NOT push `main`, merge, run `vercel --prod`, promote, alias, run migrations or edit environment variables. If the user's message in THIS task contains an explicit production authorization naming the candidate SHA, follow runbook §5 step by step instead — still stopping at every gate.

Assess and cite evidence for each:

1. **Candidate on staging** — the candidate SHA is what `barq-staging` serves (/barq-postdeploy-check) and has been there through human iPhone / browser QA (link the QA record).
2. **CI** — `gh run list --commit <sha>`: CI and Secret scan green on the candidate.
3. **Validation** — a /barq-validate table on exactly the candidate.
4. **Migrations** — list migrations the production database does not have yet (`prisma/migrations` vs the last production deploy); for each, `check-migrations` destructive-statement warnings, whether it is additive, and its backup / reversibility plan. Note: both Vercel projects build with the `package.json` `vercel-build` script (`npm run validate-env && node scripts/vercel-migrate.mjs && next build`). `barq-staging` sets that as its Build Command. `barq` keeps the default Build Command, which runs `vercel-build` when it exists, as its 2026-11-06 build log shows. `scripts/vercel-migrate.mjs` skips `prisma migrate deploy` only when `VERCEL_ENV=preview`: Preview builds still validate the environment and run `next build`, but never migrate. Every production-target build runs `prisma migrate deploy` before `next build`. A production-target `barq` build from `main` would therefore apply all pending migrations to the database its production variables name, so the migrations need an explicit, approved step (migration-safety review and a backup point) before any such build. "Production" here is Vercel's deployment target, not the live environment. `barq-staging` builds the `staging` branch as target `production` against the staging database, and that is not the live `barq` production environment (`main` → `barq`).
5. **Environment** — production variables complete for every required name (`docs/07-infrastructure/ENVIRONMENT_AUDIT.md`), checked by NAME / presence only, never values; OTP provider real; `PAYMENT_PROVIDER` as intended; external AI / OCR flags as approved.
6. **Gates still open** — `docs/project-memory/13-OPEN-QUESTIONS.md`, `23-REGISTRATION-OCR-PRIVACY-GATE.md` (privacy / legal), payment NO-GO items, pilot limitations.
7. **Rollback** — the prior production deployment id to roll back to (if any), and whether the candidate's migrations allow a code-only rollback (runbook §6).
8. **Verdict** — GO / NO-GO with the blocking items, and the exact owner actions. Then STOP.
