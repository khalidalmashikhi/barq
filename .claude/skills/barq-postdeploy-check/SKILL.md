---
name: barq-postdeploy-check
description: Read-only verification of what a BARQ Vercel project is serving right now — deployment id/status, built-from SHA, migration result, /api/health. Staging by default; production is inspection only.
argument-hint: "[barq-staging|barq] [expected-sha]"
allowed-tools: Bash(node scripts/engineering/verify-deploy.mjs *) Bash(npx vercel inspect *) Bash(npx vercel ls *) Bash(git rev-parse *) Bash(git ls-remote *)
---

# BARQ post-deploy check (read-only)

Arguments: `$ARGUMENTS` — project (default `barq-staging`) and the expected SHA (default: `git ls-remote origin refs/heads/staging` for staging).

1. `node scripts/engineering/verify-deploy.mjs --project <project> --expect <sha>` — record its full output and exit code.
2. If it fails, report exactly which line failed (status ≠ Ready, alias served by another deployment, SHA mismatch, migration failure / missing, health field ≠ ok). Do NOT redeploy, promote, alias or change environment variables to "fix" it — those are owner actions (runbook §6).
3. For `barq` (production): label every line PRODUCTION, read-only. Report "no Ready deployment behind the alias" honestly if that is the state.
4. Confirm the other project was not changed: `npx vercel ls <other-project>` newest deployment age.
5. Report: project · deployment id · status · built-from SHA vs expected · migrations found / result · health (status, database, environment, otpProvider, paymentProvider) · verdict.

Never print environment values. A pass here proves the alias, SHA, migration log and health — not that a feature works; that is the smoke test.
