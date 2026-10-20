---
name: barq-staging-rollout
description: Owner-approved rollout of exact, already-validated commits to STAGING (barq-staging) — push, monitor, verify SHA / migrations / health, smoke, docs follow-up. Never production.
argument-hint: "<expected-start-sha>..<head-sha> [approval note]"
disable-model-invocation: true
---

# BARQ staging rollout

Range and approval: `$ARGUMENTS`. This skill only runs when the user invoked it with an explicit staging approval for exactly these commits. Production (`barq`, branch `main`) is OUT OF SCOPE — never push `main`, never `vercel --prod / promote / alias / env`.

Stop at the first failed gate and report; never assume a step succeeded.

1. **Preflight** — run /barq-preflight. Branch must be `staging` (or the approved PR merged into it), tree clean, `origin/staging` == the expected start SHA (else REMOTE DRIFT → stop).
2. **Ancestry** — `git log --format="%h %p %s" <start>..HEAD` must list exactly the approved commits.
3. **Validation** — /barq-validate must have passed on exactly this HEAD in this task (record its table). If anything changed since, re-run it.
4. **Push** — `node scripts/engineering/prepush-check.mjs --target staging` (exit 0 required), then `git push origin HEAD:refs/heads/staging` (the user approves the prompt). Re-check `git ls-remote origin refs/heads/staging` == HEAD.
5. **Monitor** — find the new `barq-staging` deployment (`npx vercel ls barq-staging`), then `npx vercel inspect <url> --wait --timeout 10m`. The `barq` project's "Preview" build of the same push fails validate-env by design — cosmetic, not staging.
6. **Verify** — `node scripts/engineering/verify-deploy.mjs --project barq-staging --expect <HEAD>`: Ready, alias → this deployment, built from HEAD, migrations found = expected count with "none pending" or the expected "applied", health ok, otpProvider / paymentProvider unchanged. Migrations are applied ONLY by the build (`vercel-build`); never run one manually.
7. **Production untouched** — `npx vercel ls barq --environment production`: no new production deployment.
8. **Smoke** — read-only / synthetic only, signed out unless the owner signs in; Arabic RTL first at 375×812, then English; no real registration document; no booking / payment unless the task explicitly includes it.
9. **Docs** — record the rollout in `docs/project-memory/17-CHANGELOG-DECISIONS.md` and `01-CURRENT-STATE.md` (deployment id, SHA, migrations, health, smoke, limitations); ONE docs-only commit; push it the same way (steps 4–7).
10. **Hand-off** — final local = remote = deployed SHA, the iPhone QA checklist, remaining limitations. Then STOP.
