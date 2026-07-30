# BARQ — Staging Execution Guide (Stage 1)

Turns [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md)'s plan into an executable, repository-grounded runbook: for every item, **what already exists in the repo**, **what must be created (external/operational)**, **exact manual steps**, **exact commands**, and **expected verification**.

Scope is a **staging** environment only. No application feature, no refactor, and no database-schema change is part of this guide. Every "must be created" item below is an external/operational action (Vercel dashboard, database provider, Twilio, DNS, monitoring vendor) — none is a code change. Two items require an explicit owner decision before execution — see **§0 Decisions Required** first.

Every claim here was verified against real repository files (cited inline). Where the repository does not settle a question, it is flagged rather than assumed.

---

## 0. Decisions Required Before Execution

Two facts in the current repository force a choice that this guide cannot make for you. Both are operational/architectural, not bugs.

### D-1 — Pooled `DATABASE_URL` vs. `prisma migrate deploy` (no `directUrl` in schema)

- **Repository fact:** `prisma/schema.prisma` (lines 72–75) declares `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` with **no `directUrl`**. `vercel-build` runs `prisma migrate deploy` against that single `DATABASE_URL` (`package.json:16`).
- **Consequence:** `prisma migrate deploy` uses Prisma's Schema Engine, which per Prisma's own docs **does not support a PgBouncer transaction-mode pooler**. Both Supabase's `:6543` transaction pooler **and Neon's pooled endpoint** are transaction-mode PgBouncer, so **neither tolerates `migrate deploy` as a single URL** without a `directUrl`. A **session-mode pooler** (e.g. Supabase's port-`5432` Supavisor session pooler) *is* pooled **and** supports migrations, so it works as a single URL.
- **Options:**
  - **(A) Recommended — use a session-mode pooled endpoint as the single `DATABASE_URL`** (verified documented fit: **Supabase session-mode pooler, port 5432**, which Supabase documents for "server-based deployments" as usable for both migrations and queries via one URL). Keeps the existing single-`DATABASE_URL` setup unchanged, **zero schema change**. See Stage 2's `STAGING_PROVISIONING_PREP.md` §PostgreSQL Verification for the acceptance test and the serverless trade-off.
  - **(B)** Use a transaction-mode pooler (Neon pooled / Supabase `:6543`) and add `directUrl = env("DIRECT_URL")` to the datasource. **This is a `schema.prisma` change, out of scope, and needs explicit approval.**
- **Action:** confirm the staging DB provider supplies a session-mode pooled endpoint and validate it with the Stage 2 acceptance test before §3 proceeds. If only a transaction-mode pooler is available, Option B (schema change) requires approval.

> **SUPERSEDED (staging runtime fix — Option B now adopted).** The single-URL session-mode approach was validated in Stage-B migration testing but then **exhausted the Supabase session pool at runtime** under Vercel serverless fan-out (`FATAL: EMAXCONNSESSION — max clients reached in session mode`, `pool_size: 15`). Owner approved the schema change. The datasource now uses **both** URLs:
>
> ```
> datasource db {
>   provider  = "postgresql"
>   url       = env("DATABASE_URL")   // Transaction pooler, 6543, pgbouncer=true&connection_limit=1 — runtime
>   directUrl = env("DIRECT_URL")     // Session pooler, 5432 — migrations/CLI only
> }
> ```
>
> Transaction-mode multiplexing (many serverless instances share a small upstream pool) + `connection_limit=1` per instance is what resolves `EMAXCONNSESSION`; `directUrl` (session pooler) is what keeps `prisma migrate deploy` working, since the migration engine cannot run through a transaction-mode pooler. Set both env vars per `STAGING_ENV_TEMPLATE.md`. This is the production-correct configuration going forward.

### D-2 — Staging must not be publicly crawlable, but `robots.ts` cannot express that per-environment

- **Repository fact:** `src/app/robots.ts` unconditionally returns `allow: "/"` (with a fixed disallow list) and a `Sitemap:` line — it has **no environment branch**. It cannot emit `Disallow: /` for staging without a code change, which is out of scope.
- **Consequence:** a staging `robots.txt` change is **not required** for this release, and is **not** achievable via configuration alone on this codebase. Staging non-public access is handled by Deployment Protection (below), not by editing `robots.ts`.
- **Required no-code path:** enable **Vercel Deployment Protection** (Standard Protection / password or SSO) on the staging project. This gates the entire staging deployment behind auth — preventing crawler indexing *and* casual human access — which is strictly stronger than a `robots.txt` disallow.
- **Trade-off to note:** Deployment Protection returns `401` to unauthenticated clients, which will block the external uptime monitor (§7) and `verify-deployment.ts` (§10) unless you also enable Vercel's **"Protection Bypass for Automation"** token and pass it to those tools. Plan for that token when you turn protection on.

---

## 1. Vercel Project

**What already exists (repo):**
- `vercel-build` script: `validate-env && prisma migrate deploy && next build` (`package.json:16`).
- One cron declaration in `vercel.json`: `/api/cron/expire-stale-bookings`, `*/30 * * * *`.
- Node engine floor `>=20.0.0` (`package.json:6-8`).

**What must be created (external):**
- A **separate** Vercel project (or a distinct, separately-scoped Staging environment) — never sharing the production project's environment-variable scope.

**Exact manual steps:**
1. Vercel Dashboard → **Add New… → Project** → import the BARQ Git repository into a **new project** named e.g. `barq-staging`.
2. Framework preset: **Next.js** (auto-detected). Set **Build Command** to `npm run vercel-build` (overrides the default `next build`, so the `validate-env → prisma migrate deploy → next build` chain runs exactly as production will).
3. Leave **Output/Install** at defaults (`npm install` honors the repo's `package-lock.json` and `postinstall: prisma generate`).
4. Do **not** deploy yet — set env vars (§4/§5), the database (§2/§3), and domain (§6) first, then trigger the first deploy.
5. Enable **Deployment Protection** per **D-2** (Settings → Deployment Protection → Standard Protection). If automation needs to reach it, also enable **Protection Bypass for Automation** and record the token.
6. Confirm the staging project's **Cron** either does not overlap production or is accepted as running against the staging DB only (harmless — `expire-stale-bookings` only touches staging's own `Booking` rows).

**Exact commands:** none required locally for project creation (dashboard-driven). Optional CLI alternative: `npx vercel link` then `npx vercel --prod=false` from the repo root once env vars are set.

**Expected verification:** the project exists in Vercel, Build Command reads `npm run vercel-build`, Deployment Protection is on, and no environment variable is shared with production.

---

## 2. PostgreSQL Staging Database

**What already exists (repo):**
- Prisma with `provider = "postgresql"` and a committed migration history under `prisma/migrations/`.
- `vercel-build` applies migrations automatically (`prisma migrate deploy`).
- Optional seed hook: `prisma.seed = "tsx prisma/seed.ts"` (`package.json:57-59`) — inspect `prisma/seed.ts` before running; do not assume its contents.

**What must be created (external):**
- A **physically separate** Postgres instance — never a schema/namespace inside the production DB, never any developer's local DB. It must start empty (or from a known seeded baseline) and be disposable (DR Drill and Load Test will write to and restore it).

**Exact manual steps:**
1. Provision a new Postgres instance/branch on the chosen provider (per **D-1**, prefer one whose pooled endpoint tolerates `prisma migrate deploy`).
2. Capture the **pooled** connection string (see §3).
3. Confirm the database is empty before first deploy.

**Exact commands (run locally against the staging DB, or rely on `vercel-build`):**
```bash
# Migrations are applied automatically by vercel-build on first deploy.
# To apply/inspect manually against staging from your shell:
DATABASE_URL="<staging-pooled-url>" npx prisma migrate deploy
DATABASE_URL="<staging-pooled-url>" npx prisma migrate status
# Optional baseline seed — ONLY after reading prisma/seed.ts:
DATABASE_URL="<staging-pooled-url>" npx prisma db seed
```
> Windows PowerShell equivalent for setting the inline var:
> ```powershell
> $env:DATABASE_URL="<staging-pooled-url>"; npx prisma migrate deploy
> ```

**Expected verification:** `npx prisma migrate status` reports "Database schema is up to date!" with no pending migrations; the DB is reachable and isolated from production.

---

## 3. DATABASE_URL (Pooled)

**What already exists (repo):**
- Datasource reads `env("DATABASE_URL")` only — **no `directUrl`** (`prisma/schema.prisma:72-75`). See **D-1**.
- The health endpoint proves real connectivity with a `SELECT 1`, not just client construction (`src/lib/observability/check-database-health.ts`, used by `src/app/api/health/route.ts`).

**What must be created (external):**
- The provider's **pooled** connection endpoint (PgBouncer/pooler), set as `DATABASE_URL` in the staging Vercel env scope.

**Exact manual steps:**
1. In the DB provider dashboard, copy the **pooled** connection string (not the direct one), including `sslmode=require` if the provider requires it.
2. Confirm the pooler mode is Prisma-compatible for **both** runtime queries **and** `migrate deploy` (per **D-1**; if it is not, stop and resolve D-1 option B under approval).
3. Set `DATABASE_URL` in Vercel → staging project → Settings → Environment Variables.

**Exact commands (connectivity smoke test before deploy):**
```bash
DATABASE_URL="<staging-pooled-url>" npx prisma db execute --stdin <<< "SELECT 1;"
```

**Expected verification:** the `SELECT 1;` returns without error; after deploy, `/api/health` reports `database=ok` (§10).

---

## 4. Environment Variables

**What already exists (repo):** the single source of truth is `scripts/env-schema.ts`, enforced at build/start by `scripts/validate-env.ts` (wired via `predev`/`prebuild`, and inside `vercel-build`). **Vercel sets `NODE_ENV=production` automatically for any deployed instance**, so staging genuinely exercises the same production-only rules the real production deploy will.

Required in **every** environment:

| Variable | Rule (from `env-schema.ts`) |
|---|---|
| `DATABASE_URL` | non-empty |
| `BETTER_AUTH_SECRET` | non-empty (and **≥ 32 chars** once `NODE_ENV=production` — i.e. on staging) |
| `BETTER_AUTH_URL` | valid URL |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | valid URL |

Additionally required because staging runs as `NODE_ENV=production`:

| Variable | Rule |
|---|---|
| `NEXT_PUBLIC_APP_URL` | valid URL, **required in production** (metadataBase/canonical/hreflang) |
| `CRON_SECRET` | **required in production** (authenticates Vercel Cron → `/api/cron/expire-stale-bookings`) |
| `OTP_PROVIDER` | **must not be `console`** in production → set to `twilio` (see §5) |

Defaults if unset: `OTP_PROVIDER=console`, `PAYMENT_PROVIDER=NONE`, `OTP_CHANNEL=sms`.

**What must be created (external):** all of the above set in the **staging** Vercel env scope with **staging-only** values — never copy a production secret into staging, never reuse a local-dev value.

**Exact manual steps:**
1. Generate fresh staging secrets:
   ```bash
   openssl rand -base64 32   # BETTER_AUTH_SECRET (≥32 chars — this satisfies it)
   openssl rand -base64 32   # CRON_SECRET
   ```
2. In Vercel staging → Settings → Environment Variables, add:
   - `DATABASE_URL` = staging pooled URL (§3)
   - `BETTER_AUTH_SECRET` = fresh value
   - `BETTER_AUTH_URL` = `https://<staging-domain>` (§6)
   - `NEXT_PUBLIC_BETTER_AUTH_URL` = `https://<staging-domain>`
   - `NEXT_PUBLIC_APP_URL` = `https://<staging-domain>`
   - `CRON_SECRET` = fresh value
   - `OTP_PROVIDER` = `twilio` (+ Twilio vars in §5)
   - `PAYMENT_PROVIDER` = `NONE` (matches approved launch state; do **not** enable Stripe here)
3. Do **not** set `NODE_ENV` by hand — Vercel manages it for deployed instances.

**Exact commands (validate the exact var set locally before deploy):**
```bash
# Simulate the production gate the staging deploy will run:
NODE_ENV=production DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... \
NEXT_PUBLIC_BETTER_AUTH_URL=... NEXT_PUBLIC_APP_URL=... CRON_SECRET=... \
OTP_PROVIDER=twilio TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=... \
npm run validate-env
```
> PowerShell: set each with `$env:NAME="..."` on one line separated by `;`, then `npm run validate-env`.

**Expected verification:** `validate-env` prints `Environment variables validated.` and exits 0. Any missing/invalid var prints an itemized `path: message` list and exits 1.

---

## 5. Twilio OTP Configuration

**What already exists (repo):**
- BARQ uses **Twilio Programmable Messaging** (the REST Messages API, `src/lib/otp/providers/twilio-provider.ts` → `POST .../Messages.json`). It **generates the OTP itself** (Better Auth `phoneNumber` plugin) and sends it as an SMS body. It does **not** use **Twilio Verify** and does **not** use a **Messaging Service SID**.
- `OTP_PROVIDER=twilio` activates the real provider factory (`src/lib/otp/get-otp-provider.ts`), which **throws** if any of `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` is missing (enforced in `env-schema.ts` `.superRefine`, surfaced by `checkOtpProviderHealth()`).
- The exact Twilio variables consumed are only: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `OTP_CHANNEL` (`sms` default / `whatsapp`). Staging pins `OTP_CHANNEL=sms`.
- Console provider **refuses to run** under `NODE_ENV=production`, and `env-schema.ts` fails the build if `OTP_PROVIDER=console` in production — so there is **no repository-supported mock/fake OTP path in a deployed staging**. Real delivery via Twilio is the only option.

**What must be created (external):**
- **Live** Twilio credentials from a **separate staging Twilio project or subaccount** (never production's project, credentials, or sender). **Twilio Test Credentials are simulation-only** — they never connect to a real phone, only accept magic numbers, and therefore **cannot deliver a real OTP or complete a login**. Do not use them.
- **Trial live credentials are acceptable only if actual handset delivery succeeds** — a trial account delivers only to numbers added as **Verified Caller IDs** (max 5), and Omani carrier rules may still block delivery (see the two-level model below).
- At least one **team-controlled, approved recipient** number to receive real codes.

**Exact manual steps:**
1. In the **separate staging** Twilio project: copy the **live** Account SID + Auth Token (Account Info) — **not** the Test Credentials section.
2. Obtain a **live**, SMS-capable staging sender number in **E.164** (distinct from production's).
3. Add the team-controlled recipient number(s) as **Verified Caller IDs** if on a trial account.
4. Set in Vercel staging env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `OTP_CHANNEL=sms`.
5. **Load Test (Stage 2) must not trigger real OTP sends** — it reuses pre-authenticated sessions; only the fixed, one-time bootstrap logins send real OTPs.

**Exact commands:** covered by the §4 `validate-env` command (the Twilio conditional rules run there). No separate command needed.

---

### Two-level OTP verification model

OTP readiness has **two independent levels**. Passing Level A does **not** imply Level B.

**Level A — Application OTP end-to-end** (proves BARQ's own flow works, using a team-controlled approved recipient):
- A team-controlled, **approved** recipient requests an OTP.
- The Twilio API request **succeeds** (HTTP 2xx).
- The SMS actually **reaches the handset**.
- The OTP **completes authentication** (login/registration).
- An **expired** OTP is **rejected**.
- A **reused** OTP is **rejected**.
- **Retry** behavior is verified (attempts cap).
- **Send-limit** behavior is verified (`OTP_MAX_SENDS_PER_DAY`, resend cooldown).
- **No** message is sent to an **unapproved** recipient.

**Level B — Oman delivery readiness** (a separate production-readiness gate, not part of staging sign-off):
- Test **actual `+968` delivery** to a real Omani handset.
- Verify Twilio **Messaging Geographic Permissions** allow Oman.
- Verify **sender eligibility** (the sender type can deliver to Oman).
- Verify **sender-registration requirements** (Oman Alphanumeric Sender ID pre-registration with Omantel/Ooredoo).
- Verify **delivery across the required Omani carriers**.
- **Do not mark production-ready until Level B passes.**

> ⚠️ **Explicit warnings**
> - A **successful Twilio API acceptance does not prove handset delivery.**
> - **Trial-account verification does not prove Omani carrier compatibility.**
> - **Never paste** an Account SID, Auth Token, sender number, recipient number, database URL, or Vercel bypass secret into documentation or chat — confirm availability only.

> 🚫 **Production blocker:** Production launch is **blocked** until real `+968` SMS delivery and Oman sender-compliance requirements (Level B) have been verified. Staging may proceed on Level A alone (using team-controlled approved recipients).

**Expected verification (Level A / staging):** `validate-env` passes with `OTP_PROVIDER=twilio`; after deploy, `/api/health` reports `otpProvider=twilio` (not `misconfigured`); one real OTP to an approved, team-controlled recipient completes login end-to-end, and the expiry/reuse/retry/send-limit checks above hold.

---

## 6. Staging Domain

**What already exists (repo):**
- `robots.ts` and `sitemap.ts` build absolute URLs from `getAppUrl()` (i.e. from `NEXT_PUBLIC_APP_URL`) — so the domain must match the env var for links to be correct.
- `robots.ts` has **no per-environment branch** — see **D-2**; staging privacy comes from Deployment Protection, not `robots.txt`.

**What must be created (external):**
- A distinct staging subdomain (e.g. `staging.barq.om`) or the Vercel-issued preview URL — never a production look-alike.

**Exact manual steps:**
1. Vercel staging → Settings → Domains → add `staging.barq.om` (or use the default `*.vercel.app` URL).
2. Add the DNS record Vercel specifies (CNAME/A) at the DNS provider; wait for verification. HTTPS/TLS is issued automatically by Vercel once the domain verifies.
3. Set `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` to `https://<that-domain>` (§4).
4. Apply **D-2** Deployment Protection instead of a `robots.txt` disallow.

**Exact commands (after deploy):**
```bash
curl -I https://<staging-domain>            # expect valid TLS + 200/401(if protected)
curl -s https://<staging-domain>/robots.txt # note: emits allow "/" + Sitemap line (see D-2)
```

**Expected verification:** domain resolves over HTTPS with a valid certificate; app-generated URLs use the staging origin; Deployment Protection blocks unauthenticated public access.

---

## 7. Monitoring

**What already exists (repo):**
- `/api/health` returns `{ status, database, otpProvider, paymentProvider, environment, version, timestamp }`; HTTP **200** when all checks pass, **503** when any fails (`src/app/api/health/route.ts`). This is the intended poll target.
- Structured logs via `src/lib/logger.ts`, viewable in Vercel's function logs.

**What must be created (external):**
- An external uptime monitor pointed at staging `/api/health`, configured **before** the Stage 2 Load Test so its health assertions get an independent corroborating signal.

**Exact manual steps:**
1. In the chosen uptime vendor, add a monitor for `https://<staging-domain>/api/health`, alert on non-2xx.
2. If Deployment Protection is on (D-2), configure the monitor to send the **Protection Bypass for Automation** token (header `x-vercel-protection-bypass`) so it isn't blocked by `401`.
3. Confirm Vercel staging function logs are reviewable for the drill/load/scan windows.

**Exact commands (manual health poll):**
```bash
curl -s https://<staging-domain>/api/health | jq .
# With Deployment Protection bypass:
curl -s -H "x-vercel-protection-bypass: <token>" https://<staging-domain>/api/health | jq .
```

**Expected verification:** monitor shows the endpoint **UP** with HTTP 200 and `status=ok`; a deliberately induced failure (or test alert) confirms alerting fires.

---

## 8. Test Accounts

**What already exists (repo):**
- **Customer**: auto-provisioned on first OTP sign-in (no seeding) — per `resolveBarqUser()` self-service flow.
- **Provider**: real self-service `apply-as-provider` flow, then real `approveProvider` admin action.
- **Admin**: `scripts/bootstrap-admin.ts` — the **only** supported way to create the first Admin; refuses if any Admin already exists, and requires the target phone to have signed in at least once.

**What must be created (external):** three test identities (phone numbers) for use across the DR Drill / Load Test / Security Scan.

**Exact manual steps:**
1. **Customer**: sign in on staging with a real test phone via the normal OTP flow (auto-creates the Customer row).
2. **Provider**: with a **second** phone, complete the self-service provider application; then, using the Admin (below), run the real approval action — do **not** hand-insert an `APPROVED` provider row.
3. **Admin**: with a **third** phone, sign in once normally, then promote it via the script.
4. Record the three phone numbers where the Stage 2 team can reuse them.

**Exact commands:**
```bash
# Run once, against the STAGING database, after the target phone has signed in once:
DATABASE_URL="<staging-pooled-url>" npx tsx scripts/bootstrap-admin.ts +968XXXXXXXX
# (equivalently: npm run bootstrap-admin -- +968XXXXXXXX with DATABASE_URL set)
```
> PowerShell: `$env:DATABASE_URL="<staging-pooled-url>"; npx tsx scripts/bootstrap-admin.ts +968XXXXXXXX`

**Expected verification:** the script prints `Created the first Admin: id=…`; re-running it prints the refusal message (`Refusing to run: N Admin row(s) already exist`), confirming the one-time guard; the admin can reach `/admin`, approve the provider, and the provider can then create a service.

---

## 9. Build Command

**What already exists (repo):**
- `vercel-build`: `npm run validate-env && prisma migrate deploy && next build` (`package.json:16`) — the exact chain staging must exercise.
- Quality-gate scripts: `lint` (`eslint src/`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

**What must be created (external):** nothing — only the Vercel Build Command override to `npm run vercel-build` (done in §1 step 2).

**Exact manual steps:** confirm Vercel staging → Settings → General → Build Command = `npm run vercel-build` (not the default `next build`, which would skip env validation and migrations).

**Exact commands (reproduce the staging build locally before first deploy):**
```bash
npm ci
npm run typecheck && npm run lint && npm run test && npm run build
# Full staging-equivalent chain (requires a reachable DATABASE_URL):
DATABASE_URL="<staging-pooled-url>" npm run vercel-build
```

**Expected verification:** local `typecheck`/`lint`/`test`/`build` all pass (baseline: RC re-run recorded TS clean, ESLint clean, 198 files / 1,345 tests, build ✓). On Vercel, the deploy log shows `Environment variables validated.` → `prisma migrate deploy` applying/So schema is up to date → `next build` succeeding.

---

## 10. Deployment Verification

**What already exists (repo):**
- `scripts/verify-deployment.ts` — read-only GETs against a live base URL: `/api/health` (expects 200 + `status=ok`), `/robots.txt` (expects 200 + a `Sitemap:` directive), `/sitemap.xml` (expects 200 + ≥1 `<loc>`). Note the sitemap always contains **at least the 13 static pathnames × 8 locales = 104 entries** even on an empty staging DB (`src/app/sitemap.ts`), so the sitemap check passes without any seeded content.

**What must be created (external):** nothing — this is a repository-owned script; only a reachable staging URL is needed.

**Exact manual steps:**
1. After the first successful staging deploy, run the script against the staging URL.
2. If Deployment Protection is on (D-2), either temporarily allow the runner, or run it from an environment carrying the bypass token (the script itself sends no custom header, so use a network-level bypass or a temporary protection exception window).

**Exact commands:**
```bash
npx tsx scripts/verify-deployment.ts https://<staging-domain>
# or:  npm run verify-deployment -- https://<staging-domain>
```

**Expected verification:** all three lines print `PASS` and the script exits 0 with `All checks passed.`:
```
PASS  GET /api/health    — status=ok database=ok otpProvider=twilio paymentProvider=... environment=ok
PASS  GET /robots.txt    — 200 OK, Sitemap: directive present
PASS  GET /sitemap.xml   — 200 OK, 104+ entries
```
A `503`/`degraded` from `/api/health` means an env var is still missing/invalid (run `npm run validate-env` against the staging env for the itemized reason) — not a code defect.

---

## Stage 1 Exit Criteria

Stage 1 is complete when: the staging Vercel project exists with an isolated pooled Postgres; all §4/§5 env vars are set as staging-only values; the domain resolves over HTTPS with Deployment Protection on; the uptime monitor polls `/api/health`; the three test identities exist; the first `vercel-build` deploy succeeds; and `verify-deployment.ts` reports all-PASS. At that point the Stage 2 exercises (DR Drill, Load Test, Security Scan → Go/No-Go items 4–10) have a real environment to run against.
