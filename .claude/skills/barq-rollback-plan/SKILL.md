---
name: barq-rollback-plan
description: Prepare (not execute) a BARQ rollback plan for a bad staging or production deployment — last known-good deployment, code vs environment vs database rollback, migration reversibility, verification and incident record.
argument-hint: "<barq-staging|barq> <bad-sha> [symptom]"
allowed-tools: Bash(git *) Bash(node scripts/engineering/*) Bash(npx vercel inspect *) Bash(npx vercel ls *) Read Grep Glob
---

# BARQ rollback plan (plan only)

Input: `$ARGUMENTS`. Produce a plan the owner can approve. Do not run `vercel rollback / promote / alias`, revert-and-push, env changes or any database statement — those need the owner's explicit approval in the same task (runbook §6).

1. **Impact** — what is broken, since which deployment (`verify-deploy.mjs`), who is affected, is data being written incorrectly right now (if yes: recommend pausing the affected flow first).
2. **Last known-good** — previous Ready deployment of the same project (`npx vercel ls <project>`), its SHA, and the commits between it and the bad SHA (`git log --oneline good..bad`).
3. **Classify the fix**:
   - **Code-only** (no migration between good..bad): Vercel instant rollback to the known-good deployment, or a `git revert` commit pushed through the normal pipeline (preferred for staging — keeps history linear and CI-checked).
   - **Environment** (a variable changed): restore the previous value through the Vercel dashboard by the owner, then redeploy the same SHA; never copy values into chat or files.
   - **Database** (a migration ran): `node scripts/engineering/check-migrations.mjs --base <good>` — additive migrations usually allow a code-only rollback (old code ignores new columns); DROP / type change / RENAME / data rewrite CANNOT be undone by redeploying — they need a reviewed forward-fix migration or a restore from a backup point taken before the deploy. Never delete or hand-edit rows to "undo" a change.
4. **Verification after rollback** — `verify-deploy.mjs --expect <good-sha>`, health, the smoke subset that exposed the problem.
5. **Incident record** — draft the `17-CHANGELOG-DECISIONS.md` entry: timeline, impact, root cause (or unknown), action, follow-up.
6. Present the plan with the single recommended option and STOP for approval.
