# BARQ — Stage 2: Infrastructure Provisioning Preparation

Preparation only. **No cloud resource is created, nothing is deployed, no application code or database schema is changed by this document.** It gathers the exact operator inputs, the exact PostgreSQL verification procedure, the exact Vercel configuration steps, and the remaining owner decisions needed *before* an operator provisions the staging environment described in [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md).

**Approved constraints carried into this stage:**
- **D-1 (DB):** no-code path only — do **not** modify `prisma/schema.prisma`, do **not** add `directUrl`. The single `DATABASE_URL` must be a **session-mode pooled** endpoint whose `prisma migrate deploy` compatibility is verified (see §2).
- **D-2 (Protection):** use **Vercel Deployment Protection**; do **not** modify `robots.ts`. Staging stays non-public, with a bypass token for `/api/health`, uptime monitoring, `scripts/verify-deployment.ts`, and approved operators.

### Verified documentation basis for D-1 (checked this stage)

Prisma's Schema/Migration Engine uses a single direct connection and **does not support a PgBouncer transaction-mode pooler**. Both **Neon's pooled endpoint** and **Supabase's transaction pooler (`:6543`)** are transaction-mode → neither runs `migrate deploy` as a single URL without a `directUrl`. Supabase's **session-mode pooler (port `5432`, Supavisor)** is pooled **and** supports migrations, and Supabase documents it for "server-based deployments" as a single URL for both migrations and queries — this is the verified no-code fit. Sources listed at the end.

---

## 1. Operator Input Checklist (collect all before provisioning)

Fill every "Value to confirm" before any resource is created. Anything left blank is a hard blocker for the corresponding step.

| # | Input | Why it's needed | Format / example | Value to confirm |
|---|---|---|---|---|
| 1 | **PostgreSQL provider** | Must supply a **session-mode pooled** endpoint (D-1). Verified fit: Supabase (session pooler, port 5432). | Provider name | ☐ ________ |
| 2 | **Postgres region** | Co-locate with Vercel functions to limit latency/connection cost. | Cloud region | ☐ ________ |
| 3 | **Vercel account / team** | Owns the separate staging project; determines plan limits (see cron caveat, §3.8). | Team slug | ☐ ________ |
| 4 | **Vercel plan of that team** | `*/30` cron needs Pro; Hobby caps crons at once/day. | Hobby / Pro / Enterprise | ☐ ________ |
| 5 | **Staging project name** | The new, isolated Vercel project. | e.g. `barq-staging` | ☐ ________ |
| 6 | **Staging domain** | Distinct, non-production-look-alike origin; drives `*_URL` env vars. | e.g. `staging.<domain>` or the `*.vercel.app` URL | ☐ ________ |
| 7 | **DNS access** (only if using a custom domain) | To add Vercel's CNAME/A record. | Who/where DNS is managed | ☐ ________ |
| 8 | **Vercel deploy region** | Should match the DB region (input #2). | Vercel region id | ☐ ________ |
| 9 | **Git branch for staging** | Which branch the staging project deploys from. | e.g. `staging` (recommended) or `main` | ☐ ________ |
| 10 | **Twilio LIVE staging credentials availability** | Staging requires `OTP_PROVIDER=twilio`; without credentials the build fails. Must be **live** credentials from a separate staging project/subaccount — **Twilio Test Credentials are simulation-only and cannot deliver a real OTP**. | Live staging SID + Auth Token + live staging sender + ≥1 approved recipient available? Y/N | ☐ ________ |
| 11 | **Monitoring provider** | Polls `/api/health`; must support sending a custom request header (for the bypass token). | Vendor name | ☐ ________ |
| 12 | **Test phone numbers ×3** | Customer / Provider / Admin identities reused across DR Drill, Load Test, Security Scan. | 3× E.164, team-owned | ☐ ________ |

> None of these are stored in the repository. Record them wherever the team running Stage 2 exercises can reference them (phone numbers only for #12 — no other personal data).

---

## 2. Exact PostgreSQL Verification Procedure

Run these against the **candidate staging database** *before* wiring it into Vercel. They empirically resolve D-1 and confirm the environment is fit for the Stage 2 exercises. Commands are shown for bash; PowerShell sets the inline var with `$env:DATABASE_URL="..."; <command>`.

### 2.1 Pooled-connection compatibility (session mode)
- Confirm the connection string is the provider's **session-mode pooled** endpoint (Supabase: the pooler host on port **5432**), not the transaction pooler (`:6543`) and not the raw direct host.
- Smoke-test connectivity:
  ```bash
  DATABASE_URL="<candidate-url>" npx prisma db execute --stdin <<< "SELECT 1;"
  ```
  **Expected:** completes with no error.

### 2.2 SSL requirement
- Confirm the URL carries the provider's required TLS parameter (typically `?sslmode=require`).
- Verify TLS is actually in force:
  ```bash
  DATABASE_URL="<candidate-url>" npx prisma db execute --stdin <<< "SHOW ssl;"
  ```
  **Expected:** `ssl` reports `on` (provider-dependent output). A provider that rejects a non-SSL connection is the desired posture.

### 2.3 Migration compatibility — the D-1 acceptance test (decisive)
  ```bash
  DATABASE_URL="<candidate-url>" npx prisma migrate deploy
  DATABASE_URL="<candidate-url>" npx prisma migrate status
  ```
  **Expected (PASS / no-code path validated):** `migrate deploy` applies the committed migrations with no error; `migrate status` reports the schema is up to date.
  **If it FAILS** (advisory-lock error, prepared-statement error, `P3xxx`, or a hang): the endpoint is transaction-mode and is **not** usable as a single URL. Do **not** work around it silently — either switch to a genuine session-mode endpoint, or escalate the `directUrl` schema-change decision (approval-gated; see §4 provenance). Since `vercel-build` runs `migrate deploy` on every deploy, a failure here would fail every staging deploy.

### 2.4 Connection limit
- Read the provider's pool-size / max-connections for this instance. In **session mode**, concurrent clients are capped at the configured pool size (each client holds a dedicated upstream connection for its session).
- Note the number for the Stage 2 Load Test (its §6 "Database Pressure" metric) — session-mode pooling under Vercel's serverless fan-out is exactly what that test should stress. Record the ceiling:
  ```bash
  DATABASE_URL="<candidate-url>" npx prisma db execute --stdin <<< "SHOW max_connections;"
  ```

### 2.5 Backup support
- Confirm the provider offers point-in-time recovery / snapshot backups on this instance — required for the Stage 2 **Disaster Recovery Drill** (which performs a destructive restore).
- No code depends on this; it is a provider-dashboard capability check. Record how a restore is triggered.

### 2.6 Disposable staging policy
- Confirm this database is **disposable**: it holds no real data, is physically separate from production and from any developer's local DB, and can be wiped/restored freely by the DR Drill and written to heavily by the Load Test.
- Confirm it starts empty (or from a known seeded baseline — inspect `prisma/seed.ts` before running `npx prisma db seed`; do not assume its contents).

---

## 3. Exact Vercel Configuration Steps

Perform in this order. Do **not** trigger the first deploy until §2 (Postgres) is verified and all §1 env vars from [`STAGING_ENV_TEMPLATE.md`](STAGING_ENV_TEMPLATE.md) are set.

### 3.1 Separate staging project
- Vercel Dashboard → **Add New… → Project** → import the same BARQ Git repository into a **new** project (input #5).
- **Do not** reuse the production project or share its environment-variable scope.

### 3.2 Build Command
- Settings → General → **Build Command** → override to `npm run vercel-build` (not the default `next build`). This runs the exact `validate-env → prisma migrate deploy → next build` chain.
- Install Command: leave default (`npm install` honors `package-lock.json` + `postinstall: prisma generate`).

### 3.3 Node version
- Repo declares `engines.node: ">=20.0.0"` (`package.json`) and pins no `.nvmrc`.
- Settings → General → **Node.js Version** → select **20.x** (recommended, for parity with production) — or 22.x if production uses it. Must be ≥ 20.

### 3.4 Environment variables
- Settings → Environment Variables → add every **Required** variable from [`STAGING_ENV_TEMPLATE.md`](STAGING_ENV_TEMPLATE.md) §1, staging-only values, generating fresh secrets for the 🔒 items.
- Scope them to the environment the staging branch deploys to (Production environment of the staging project if using a dedicated branch — see 3.5).
- Remember 🌐 `NEXT_PUBLIC_*` values are baked at **build time** — changing them later requires a redeploy, not just a settings save.

### 3.5 Git branch
- Settings → Git → set the **Production Branch** of the *staging project* to the chosen branch (input #9). **Recommended:** a dedicated `staging` branch so staging redeploys are intentional, not every push to `main`.
- Optionally disable auto-deploys for other branches to avoid noise.

### 3.6 Deployment Protection (D-2)
- Settings → **Deployment Protection** → enable **Standard Protection** (Vercel Authentication) for all deployments, or Password Protection.
- This makes every staging URL return `401` to unauthenticated clients — the intended non-public posture.

### 3.7 Bypass-token usage (D-2)
- Settings → Deployment Protection → **Protection Bypass for Automation** → generate the token; record it as a secret.
- **Uptime monitor & any header-capable client:** send header `x-vercel-protection-bypass: <token>` (see §7 of the execution guide).
- **`scripts/verify-deployment.ts`:** the script sends **no** custom header (it builds `${baseUrl}/api/health` directly), so it cannot carry the bypass header as-is. For its one-time post-deploy run, either (a) run it during a brief, deliberate window with protection temporarily set to allow, then re-enable; or (b) run it from an approved-operator context that Vercel already trusts. Do **not** modify the script (out of scope).
- **Approved operators:** reach staging via normal Vercel Authentication (their Vercel account), no token needed.

### 3.8 Cron behavior
- `vercel.json` declares one cron: `/api/cron/expire-stale-bookings`, `*/30 * * * *`. The staging project will schedule it too, running **against the staging DB only** — harmless (it only touches staging's own `Booking` rows).
- **Plan caveat (input #4):** on a **Hobby** plan, Vercel Cron is limited to **once per day**, so `*/30` will not run as written. If staging is on Hobby, either accept that stale-booking expiry isn't exercised on the 30-min cadence in staging (invoke the route manually with the `CRON_SECRET` bearer token when the DR/Load exercises need it), or run the staging project on **Pro**. **RESOLVED (§4): staging is on Pro, so the `*/30` cron runs as written.**

### 3.9 Staging domain
- Settings → **Domains** → add the domain (input #6). For a custom subdomain, add the CNAME/A record Vercel specifies at the DNS provider (input #7) and wait for verification. HTTPS/TLS is issued automatically once verified.
- Ensure `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` all equal `https://<that-domain>`.
- Staging privacy comes from Deployment Protection (3.6), **not** a `robots.txt` disallow (`robots.ts` has no per-environment branch — see D-2).

---

## 4. Remaining Owner Decisions (genuine judgment calls)

> **RESOLVED (Stage 3), with decision #1 later REVISED.** Decisions locked in [`STAGING_PROVISIONING_RUNBOOK.md`](STAGING_PROVISIONING_RUNBOOK.md): (1) Supabase pooling — **initially** session-mode single URL, **now REVISED** to the two-URL model (`DATABASE_URL` = Transaction pooler 6543 with `pgbouncer=true&connection_limit=1`; `DIRECT_URL` = Session pooler 5432; `schema.prisma` declares `url` + `directUrl`) after the single-URL approach exhausted the session pool at runtime under Vercel serverless — see `STAGING_EXECUTION_GUIDE.md` D-1; (2) Vercel **Pro**; (3) domain **`staging.barq.om`** with Vercel-domain fallback; (4) dedicated **`staging`** branch; (5) **Better Stack**. Original decision text retained below for provenance.

Everything else is mechanical once inputs (§1) are supplied. These are not:

1. **DB pooling posture under serverless (the one substantive decision).** The approved no-code path uses a **session-mode single URL** (Supabase 5432). Supabase's *serverless-optimal* guidance instead pairs a `:6543` transaction pooler (`DATABASE_URL`) with a `5432` `directUrl` for migrations — but that `directUrl` is an approval-gated `schema.prisma` change. **Decision:** accept session-mode-single-URL for staging (recommended — simplest, zero schema change, and the Load Test will show whether its connection ceiling is adequate), **or** approve adding `directUrl` to adopt the transaction-pooler split. *(Any change for production is a separate future decision, out of scope now.)*
2. **Vercel plan for staging (cron cadence).** Accept a Hobby-plan staging where the `*/30` cron won't run on schedule (invoke the expiry route manually during exercises), **or** put staging on Pro so the cron runs as in production. See §3.8.
3. **Staging domain choice.** Custom subdomain (needs DNS access, input #7) **or** the Vercel-issued `*.vercel.app` URL (no DNS, faster). Either satisfies D-2 once Deployment Protection is on.
4. **Git branch strategy.** Dedicated `staging` branch (recommended — intentional redeploys) **or** deploy staging from `main`.
5. **Monitoring vendor selection.** Not chosen in the repo. Must support a custom request header (for the bypass token). Owner picks the vendor.

Blocking dependency (not a decision, a prerequisite): **Twilio LIVE staging credentials must actually be available** (input #10) — staging cannot build with `OTP_PROVIDER=twilio` and no credentials. Twilio **Test Credentials are simulation-only and unsuitable** — they cannot deliver a real OTP. See `STAGING_EXECUTION_GUIDE.md` §5's two-level verification model; note that Oman `+968` delivery (Level B) is a separate production-readiness gate and must **not** be assumed ready.

---

## Stage 2 Readiness Verdict

**READY TO PROVISION — owner decisions (§4) are resolved and locked; pending operator inputs (§1) and Twilio LIVE staging credentials.**

- The repository side is fully prepared and requires **no code or schema change**: build chain (`vercel-build`), env schema, health endpoint, deployment-verification script, admin bootstrap, cron, robots/sitemap are all in place and were re-verified this stage.
- The D-1 no-code path is **documented-verified** with a concrete acceptance test (§2.3) that must PASS on the chosen endpoint before first deploy.
- The D-2 protection posture is fully specified, including the one honest limitation (`verify-deployment.ts` cannot carry the bypass header — handle via a brief protection window).
- Owner decisions in §4 are **RESOLVED** and locked in [`STAGING_PROVISIONING_RUNBOOK.md`](STAGING_PROVISIONING_RUNBOOK.md) (session-mode single URL; Vercel Pro; `staging.barq.om` with Vercel-domain fallback; dedicated `staging` branch; Better Stack).
- **Cannot proceed to actual provisioning until:** all §1 inputs are supplied, and Twilio **live staging credentials** (not Test Credentials) are confirmed available.

No infrastructure was created. No deploy was triggered. Nothing was committed or pushed.

---

## Sources (D-1 documentation verification)

- [Configure Prisma Client with PgBouncer — Prisma Docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- [Prisma — Supabase Docs](https://supabase.com/docs/guides/database/prisma)
- [Connect to your database — Supabase Docs](https://supabase.com/docs/guides/database/connecting-to-postgres)
