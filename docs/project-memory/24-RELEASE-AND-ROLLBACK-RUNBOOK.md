# 24 — Release and Rollback Runbook (controlled BARQ delivery path)

The single operational procedure for getting a change from request to staging, and — only with the owner's explicit approval — to production, and for undoing it. Written 2026-10-20 from the **verified** setup (inventory below), not from the older generic runbook. Where they disagree, this file describes reality; `docs/07-infrastructure/PRODUCTION_RUNBOOK.md` remains the ADR-gated reference for host-agnostic production steps.

## 0. The real setup (verified 2026-10-20)

| Thing | Fact |
|---|---|
| Repository | `khalidalmashikhi/barq` — **public**, default branch `staging` |
| Branch roles | `feat/*`, `fix/*`, `docs/*`, `chore/*` → work branches · `staging` → integration + staging deploy · `main` → production deploy |
| Branch protection | **none yet** on `staging` or `main` (owner action §8) |
| Vercel `barq-staging` | production branch **`staging`**; build `npm run vercel-build` = `validate-env && prisma migrate deploy && next build`; alias **barq-staging.vercel.app** |
| Vercel `barq` (production) | production branch **`main`** (Git auto-deploy ON); build is the default `npm run build` — **does NOT run `prisma migrate deploy`**; alias `barq-barq4.vercel.app`; last production deployment (`ad4aa84`, ~80 days old) is in **ERROR** — production serves nothing today |
| Preview builds | every push also creates a `barq` **Preview** build that fails `validate-env` (preview env lacks `NEXT_PUBLIC_APP_URL`, `OTP_PROVIDER=console`) — **cosmetic**; judge staging only by `barq-staging` |
| CI | `.github/workflows/ci.yml` + `secret-scan.yml` (PRs into / pushes to `staging` and `main`; actions pinned to commit SHAs); the build runs against a **disposable** `postgres:16` service migrated from zero inside the runner (never a real database); CI **never deploys**. Check names: `Guards (whitespace, scope, migrations, translations)`, `Typecheck, Lint, Prisma, Tests, Build, Bundle scan`, `Scan added commits for credentials` |
| GitHub security | secret scanning + push protection ON; Dependabot security updates OFF |
| Migrations | 66 in `prisma/migrations`; applied to staging **only** by the `barq-staging` build |

## 1. Feature branch

1. `/barq-preflight` (read-only): branch, HEAD, clean tree, `origin/staging` drift, deployed staging SHA, migrations, scope boundary. Plan → **wait for explicit approval** (CLAUDE.md).
2. `git switch -c feat/<short-name> origin/staging` — one scoped change per branch; never work directly on `staging` for new features.
3. Small commits; never amend, rebase, force-push or `--no-verify` (the guard hook blocks them).

## 2. Pull request

1. `/barq-validate` on the branch HEAD — every gate separately, exact exit codes; the full suite and the build never run concurrently.
2. `node scripts/engineering/prepush-check.mjs --target feat/<name>`, then push the branch (approval prompt).
3. `gh pr create --base staging` with: scope (in / out), sensitive areas touched (`scope-check` output), migration list + reversibility, validation table, screenshots (synthetic / redacted only), QA plan.

## 3. CI expectations (must be green before merge)

| Job | Checks |
|---|---|
| Guards | `git diff --check`, prohibited scope, migration-file integrity (applied migrations immutable, ordering, destructive-statement warnings), translation parity |
| Quality | typecheck, production env-shape validation, `prisma validate`, lint, focused tests (`vitest --changed`), full suite, build, client-bundle scan |
| Secret scan | every commit of the PR / push scanned on its own (never cancelled by a newer run) |

A red check is fixed forward on the branch. CI is never bypassed; a guard is never weakened to pass.

## 4. Staging rollout (owner approves the exact commits)

`/barq-staging-rollout <start>..<head>`, which is:

1. Merge the PR into `staging` (or, for an approved direct rollout, push exactly the approved, validated range — `prepush-check` must pass: clean tree, no remote drift, fast-forward only).
2. Monitor: `npx vercel ls barq-staging` → `npx vercel inspect <url> --wait`.
3. **Migrations**: applied by the build's `prisma migrate deploy` only. Never run one manually. Expect "N migrations found … No pending migrations" or "… successfully applied" for exactly the new ones.
4. Verify: `node scripts/engineering/verify-deploy.mjs --project barq-staging --expect <head>` — Ready, alias → this deployment, built from `<head>`, migration result, health (`status`, `database`, `environment` ok; `otpProvider` / `paymentProvider` unchanged).
5. Production untouched: `npx vercel ls barq --environment production` shows no new deployment.
6. Smoke (§5a), docs follow-up (one docs-only commit, verified the same way), iPhone QA hand-off.

### 5a. Smoke checks (staging)

Arabic RTL first at 375×812, then 430×932, English LTR, desktop 1440; signed out unless the owner signs in (never with the owner's credentials by an agent; staging OTP is real SMS). Synthetic / read-only data only; no real registration document; no booking / payment unless the task includes it. Confirm zero unexpected outbound calls for features behind a disabled provider.

## 5. Production release (explicit owner approval only)

Production is never reached "because code reached staging". It requires, in the same task, the owner's written authorization naming the candidate SHA.

1. `/barq-production-readiness <sha>` → GO verdict, open gates closed (privacy / legal, payment NO-GO, pilot limits).
2. **Migrations for production**: the `barq` project's build does not migrate. Before the first real production deploy the owner either sets its Build Command to `npm run vercel-build` (migrations in the build, as staging) or runs `prisma migrate deploy` against production as an explicit, approved, backed-up step. Take a database backup / point-in-time marker first.
3. Merge `staging` → `main` through a PR (protected branch, green CI, owner review). Vercel's Git integration deploys `main` to `barq`.
4. Verify: `verify-deploy.mjs --project barq --expect <sha>`, health, production smoke, monitoring.
5. Record the release (deployment id, SHA, migrations, health) in `17-CHANGELOG-DECISIONS.md`.

## 6. Rollback

**Decide first** (`/barq-rollback-plan`): what is broken, since which deployment, is bad data being written now (if yes, pause the flow first), which kind of rollback applies. The owner approves the chosen action.

| Kind | How | Limits |
|---|---|---|
| **Code** | Vercel instant rollback to the last known-good **Ready** deployment of the same project (owner, dashboard or `vercel rollback`) — or, preferred on staging, a `git revert` commit through the normal PR / CI path | Instant rollback restores code only — it does not undo migrations or env changes |
| **Environment** | Owner restores the previous variable value in Vercel, then redeploys the same SHA | Values are never copied into chat, files or commits |
| **Database** | **Additive** migration (new table / nullable column / index): a code rollback is usually safe — old code ignores the new objects. **Non-additive** (DROP, type change, RENAME, data rewrite — `check-migrations.mjs` flags these): a redeploy CANNOT undo it; only a reviewed forward-fix migration or a restore from the backup taken before the deploy | Prisma has no down-migrations. Never delete or hand-edit rows to "undo" a committed change. 8 historical migrations contain such statements (`check-migrations.mjs` over all history): the three 2026-07-07 Better Auth ID / user migrations and `availability_capacity_model` (DROP / type change / rename), `phase_5_2_audit_log_and_indexes` (drops), and three data backfills (`provider_verification_and_booking_backfill`, `taxonomy_v1_expand`, `gate_b_backfill_provider_category_provenance`) |

After any rollback: `verify-deploy.mjs --expect <good-sha>`, health, the smoke subset that exposed the problem, `prisma migrate status` expectations.

## 7. Incident documentation

Within the same day, a dated entry in `docs/project-memory/17-CHANGELOG-DECISIONS.md`: timeline (UTC + Oman time), impact, detection, root cause (or "unknown"), action taken (with deployment ids / SHAs), data affected, follow-up items (also in `13-OPEN-QUESTIONS.md` if unresolved).

## 8. Owner actions this runbook depends on (not done by any agent)

1. **Protect `main`**: require a pull request, ≥1 approving review (owner), required status checks `Guards (whitespace, scope, migrations, translations)`, `Typecheck, Lint, Prisma, Tests, Build, Bundle scan`, `Scan added commits for credentials`; no force pushes; no deletions; include administrators if desired. This is what makes "production only through the protected path" true.
2. **Protect `staging`**: require pull requests (allow the owner to bypass for an approved direct rollout if wanted), required checks as above, no force pushes / deletions.
3. **Vercel `barq` (production)**: decide the migration path (§5.2) and, optionally, disable automatic production deploys from `main` (Settings → Git → "Ignored Build Step" or per-branch deployment control) so a production deploy needs a deliberate promote.
4. **Vercel MCP** (optional, read-only inspection from Claude): `claude mcp add --transport http vercel https://mcp.vercel.com`, then `/mcp` to authenticate via OAuth. No token is stored in the repository.
5. **Claude GitHub integration** (optional): install the Claude GitHub App, add the `ANTHROPIC_API_KEY` Actions secret, set the repository variable `CLAUDE_GITHUB_ENABLED=true` — `.github/workflows/claude.yml` stays inert until then.
6. **Dependabot security updates**: enable (Settings → Code security).
7. **Preview environment** (optional): give the Vercel Preview environment `NEXT_PUBLIC_APP_URL` and a non-console `OTP_PROVIDER` so preview builds stop failing (never weaken `validate-env`).
