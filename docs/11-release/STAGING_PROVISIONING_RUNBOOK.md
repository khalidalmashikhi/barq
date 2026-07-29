# BARQ — Stage 3: Operator-Assisted Staging Provisioning Runbook

The step-by-step runbook an operator + owner follow together to provision BARQ staging. Every cloud action is the **owner's** to perform; this runbook tells them exactly what to do, what to return, and — critically — **what must never be pasted into chat**.

**Nothing in this document creates or modifies a cloud resource by itself.** It stops before the first external action and hands control to the owner at explicit pause points.

## Approved decisions locked for Stage 3

| Area | Locked choice |
|---|---|
| Database | **Supabase PostgreSQL**, **Supavisor Session Pooler, port 5432** only. Not the transaction pooler (`:6543`). No `schema.prisma` change, no `directUrl`/`DIRECT_URL`. |
| Hosting | Separate **Vercel Pro** project, name **`barq-staging`**, **Node.js 20.x**, build command **`npm run vercel-build`**. |
| Git | Dedicated **`staging`** branch. No commit/push unless explicitly instructed. |
| Domain | Preferred **`staging.barq.om`**; if DNS not ready, use the generated Vercel domain temporarily. |
| Monitoring | **Better Stack**, custom request header carrying a Vercel bypass secret, polling **`/api/health`**. |
| Protection | **Vercel Deployment Protection** on; **two separate automation bypass secrets** — one for monitoring, one for verification/testing (Vercel supports multiple bypass secrets per project — verified). Secrets never in source control or `NEXT_PUBLIC_*`. |
| Payments / OTP | `PAYMENT_PROVIDER=NONE`; `OTP_PROVIDER=twilio` (owner supplies Twilio **LIVE** staging credentials manually — never Test Credentials). |

---

## 1. Owner Input Form (only values still required)

Return these to proceed. For anything marked **🔒 do NOT paste** — confirm *availability/readiness only*; the actual value is entered directly into the provider dashboard or your own shell, never into chat.

| # | Item | What to return | Paste into chat? |
|---|---|---|---|
| 1 | **Vercel Team/account identifier** | Team slug (e.g. `barq-team`) | ✅ slug only |
| 2 | **Supabase organization/account** | Org name or "ready" | ✅ name only |
| 3 | **Supabase region** | Region id (e.g. `eu-central-1` Frankfurt, or `ap-south-1` Mumbai) | ✅ |
| 4 | **Vercel Pro billing** | "Confirmed — staging project will be on Pro" | ✅ confirmation only |
| 5 | **`staging.barq.om` DNS access** | "Yes, I control DNS" / "No — use Vercel domain for now" | ✅ |
| 6 | **Staging Twilio LIVE Account SID** availability | "Available" (starts `AC…`) — **live** creds from a separate staging project, **not** Test Credentials | 🔒 do NOT paste the SID |
| 7 | **Staging Twilio LIVE Auth Token** availability | "Available" | 🔒 do NOT paste the token |
| 8 | **Staging LIVE sender number** availability | "Available — E.164 staging sender" (distinct from production) | 🔒 do NOT paste the number |
| 9 | **≥1 team-controlled approved recipient** availability | "Available" (Verified Caller ID if on trial) | 🔒 do NOT paste the number |
| 10 | **Oman sender-registration status** (Level B) | e.g. "not started / in progress / done" | ✅ status only |
| 11 | **Oman delivery-test status** (Level B) | e.g. "not tested / passed" | ✅ status only |
| 12 | **Customer test phone number** | Needed only at Step I | 🔒 provide at Step I, not now |
| 13 | **Provider test phone number** | Needed only at Step I | 🔒 provide at Step I, not now |
| 14 | **Admin test phone number** | Needed only at Step I | 🔒 provide at Step I, not now |
| 15 | **Better Stack alert destination** | Where alerts go (e.g. "email: ops@…", "Slack #alerts") | ✅ destination only |

> **Twilio note:** BARQ uses **Twilio Programmable Messaging** (no Verify, no Messaging Service SID). Exact variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `OTP_CHANNEL`. **Twilio Test Credentials are simulation-only and unsuitable** — staging needs **live** credentials. Trial live credentials are acceptable **only if actual handset delivery succeeds**. Oman `+968` delivery (rows 10–11, Level B) is a separate production-readiness gate — **do not assume it is ready**.
>
> Rationale: SID/token/sender/recipient numbers and the `DATABASE_URL` all contain or act as secrets. They go straight into Vercel/Supabase/your shell. Chat only ever needs a "ready / done / PASS" style confirmation — **never paste** an Account SID, Auth Token, sender number, recipient number, database URL, or Vercel bypass secret into documentation or chat.

---

## 2. Commands Ready to Run

PowerShell is shown first (this project's primary shell on Windows); a bash equivalent follows where the syntax differs. Fill real values **in your shell only** — never commit them, never paste them here.

### 2.1 Create / check the `staging` branch
No `staging` branch exists yet (current branch: `main`). This is local only — it does **not** push.
```powershell
git branch --show-current           # expect: main
git fetch origin
git switch -c staging               # create local staging branch
# When (and only when) you explicitly instruct a push:
# git push -u origin staging
```
(bash: identical `git` commands.)

### 2.2 Local environment validation (simulates the staging build gate)
```powershell
$env:NODE_ENV="production"
$env:DATABASE_URL="<supabase-session-pooler-url>"
$env:BETTER_AUTH_SECRET="<generated-32+>"
$env:BETTER_AUTH_URL="https://<staging-domain>"
$env:NEXT_PUBLIC_BETTER_AUTH_URL="https://<staging-domain>"
$env:NEXT_PUBLIC_APP_URL="https://<staging-domain>"
$env:CRON_SECRET="<generated>"
$env:OTP_PROVIDER="twilio"; $env:OTP_CHANNEL="sms"
$env:TWILIO_ACCOUNT_SID="<staging-live-sid>"; $env:TWILIO_AUTH_TOKEN="<staging-live-token>"; $env:TWILIO_FROM_NUMBER="<staging-live-e164>"
$env:PAYMENT_PROVIDER="NONE"
npm run validate-env
```
Generate the two 🔒 secrets (PowerShell, no OpenSSL needed):
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))   # run twice: BETTER_AUTH_SECRET, CRON_SECRET
```
(bash: `openssl rand -base64 32`.) **Expected:** `Environment variables validated.` exit 0.

### 2.3 Prisma migration-compatibility test (the D-1 acceptance test — decisive)
Run against the Supabase **session-pooler** URL. If this fails, staging cannot deploy.
```powershell
$env:DATABASE_URL="<supabase-session-pooler-url>"
"SELECT 1;" | npx prisma db execute --stdin --schema prisma/schema.prisma   # connectivity
npx prisma migrate deploy                                                    # apply committed migrations
npx prisma migrate status                                                    # expect: up to date
```
(bash: `DATABASE_URL="…" npx prisma migrate deploy`, etc.) **Expected PASS:** migrations apply with no advisory-lock / prepared-statement / `P3xxx` error; status reports up to date.

### 2.4 Deployment verification (automated post-deploy check)
```powershell
npx tsx scripts/verify-deployment.ts https://<staging-domain>
# or: npm run verify-deployment -- https://<staging-domain>
```
Note: this script sends **no** custom header, so it cannot carry a bypass secret. Run it during a brief window with protection temporarily set to allow, or from an operator-authenticated context (see Step J).

### 2.5 Health endpoint verification (with monitoring bypass secret)
```powershell
curl.exe -s https://<staging-domain>/api/health
# With the bypass secret (run locally; never echo the secret into chat):
curl.exe -s -H "x-vercel-protection-bypass: <secret>" https://<staging-domain>/api/health
```
**Expected once fully configured:** HTTP 200, `status=ok database=ok otpProvider=twilio environment=ok`.

### 2.6 Smoke-test launch (manual)
The smoke test is a **manual browser sequence**, not a script. Open the (protected) staging URL in an authenticated operator browser and follow [`SMOKE_TEST_GUIDE.md`](SMOKE_TEST_GUIDE.md) — Customer, then Provider, then Admin sequences. The automated `verify-deployment.ts` (2.4) is the scripted sanity pass that precedes it.

---

## 3. Ordered Provisioning Procedure (with explicit pause points)

Execute A → J in order. Each **⏸ PAUSE** hands control to the owner and states exactly what to do, what NOT to paste, and the safe confirmation to return before the next step.

### A. Supabase creation ⏸ PAUSE
- **Owner does:** create the Supabase project under the chosen org (Form #2) in the chosen region (Form #3). Copy the **Session Pooler** connection string (host on port **5432**) from Project → Settings → Database → Connection string → *Session pooler*. Append `?sslmode=require` if not present.
- **Value/confirmation needed:** project created; session-pooler (5432) string obtained; billing tier noted.
- **Do NOT paste:** the connection string (it contains the DB password).
- **Safe confirmation to return:** *"Supabase project created in `<region>`; session-pooler (5432) connection string obtained; SSL required."*

### B. Supabase session-pooler validation ⏸ PAUSE
- **Owner does:** in their own shell, set `DATABASE_URL` to that string and run the **2.3** commands.
- **Value/confirmation needed:** the D-1 acceptance test result, plus the pool-size / `max_connections` number for the Stage 2 Load Test.
- **Do NOT paste:** the URL or password. Only the outcome.
- **Safe confirmation to return:** *"2.3 PASS — `migrate deploy` applied, `migrate status` up to date; max_connections = `<n>`."* (If FAIL: paste only the Prisma error **code/line**, not the URL — this is a blocker to resolve before C.)

### C. Vercel project creation ⏸ PAUSE
- **Owner does:** Vercel → Add New → Project → import the BARQ repo into a **new** project named `barq-staging` under the team (Form #1); confirm the team is on **Pro** (Form #4). Set **Production Branch = `staging`**, **Node.js 20.x**, **Build Command = `npm run vercel-build`**. Do **not** deploy yet.
- **Value/confirmation needed:** project exists; Pro confirmed; branch/Node/build-command set.
- **Do NOT paste:** nothing sensitive here.
- **Safe confirmation to return:** *"`barq-staging` created on Pro; Production Branch=staging, Node 20.x, build=`npm run vercel-build`; not deployed."*

### D. Environment variables ⏸ PAUSE
- **Owner does:** in `barq-staging` → Settings → Environment Variables, add every **Required** variable from [`STAGING_ENV_TEMPLATE.md`](STAGING_ENV_TEMPLATE.md) §1 — the `DATABASE_URL` (session pooler), freshly generated `BETTER_AUTH_SECRET` and `CRON_SECRET`, the `*_URL` values (use `https://staging.barq.om` if DNS is ready, else the Vercel-generated URL for now), `OTP_PROVIDER=twilio`, `OTP_CHANNEL=sms` + the three **live** staging Twilio values (Form #6–8, **not** Test Credentials), and `PAYMENT_PROVIDER=NONE`.
- **Value/confirmation needed:** all Required vars present and staging-only.
- **Do NOT paste:** any of the values — they are entered directly in Vercel. Never put secrets in `NEXT_PUBLIC_*`.
- **Safe confirmation to return:** *"All Required env vars set in barq-staging (staging-only values); live staging Twilio creds in place; PAYMENT_PROVIDER=NONE."*

### E. First deployment ⏸ PAUSE
- **Owner does:** trigger the first deploy of the `staging` branch (push to `staging` when instructed, or Vercel → Deploy). Watch the build log for `Environment variables validated.` → `prisma migrate deploy` → `next build` success.
- **Value/confirmation needed:** deploy succeeded; the deployment URL.
- **Do NOT paste:** build logs containing any env values (Vercel masks secrets, but don't copy raw env dumps).
- **Safe confirmation to return:** *"Deploy succeeded; URL = `https://<…>.vercel.app`."* (The URL itself is safe to share.)

### F. Deployment protection ⏸ PAUSE
- **Owner does:** Settings → Deployment Protection → enable **Standard Protection**. Then under **Protection Bypass for Automation**, create **two** secrets with notes: `monitoring-betterstack` and `verification-testing`.
- **Value/confirmation needed:** protection on; two bypass secrets created and labeled.
- **Do NOT paste:** either bypass secret.
- **Safe confirmation to return:** *"Deployment Protection on; two bypass secrets created (monitoring, verification)."*

### G. Monitoring (Better Stack) ⏸ PAUSE
- **Owner does:** in Better Stack, create an uptime monitor for `https://<staging-domain>/api/health`; add a **custom request header** `x-vercel-protection-bypass: <monitoring bypass secret>`; set alert destination (Form #15); expect HTTP 200.
- **Value/confirmation needed:** monitor live and reporting UP; a test alert fires to the destination.
- **Do NOT paste:** the bypass secret.
- **Safe confirmation to return:** *"Better Stack monitor on /api/health = UP (200); test alert received at `<destination>`."*

### H. Custom domain ⏸ PAUSE *(skip if using the Vercel domain for now)*
- **Owner does (needs DNS access, Form #5):** Vercel → Domains → add `staging.barq.om`; create the CNAME/A record Vercel specifies; wait for verification + auto-TLS. Then update `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` to `https://staging.barq.om` and **redeploy** (NEXT_PUBLIC_* bake at build time).
- **Value/confirmation needed:** domain verified over HTTPS; URLs updated; redeployed.
- **Do NOT paste:** nothing sensitive.
- **Safe confirmation to return:** *"staging.barq.om verified over HTTPS; env URLs updated; redeployed."* (Or: *"Deferred — staying on Vercel domain."*)

### I. Test accounts ⏸ PAUSE *(owner-provided phone numbers required here)*
- **Owner does:** Customer — sign in on staging with the Customer test phone (Form #12) via real OTP. Provider — apply via the self-service flow with the Provider phone (Form #13). Admin — sign in once with the Admin phone (Form #14), then promote:
  ```powershell
  $env:DATABASE_URL="<supabase-session-pooler-url>"; npx tsx scripts/bootstrap-admin.ts +968XXXXXXXX
  ```
  Then, as Admin, approve the Provider application.
- **Value/confirmation needed:** the three identities exist; provider approved.
- **Do NOT paste:** OTP codes or the `DATABASE_URL`. The phone numbers are needed to run the flow — provide team-owned test numbers only.
- **Safe confirmation to return:** *"Customer, Provider, Admin created; provider approved; bootstrap-admin printed 'Created the first Admin'."*

### J. Verification ⏸ PAUSE
- **Owner does:** run **2.4** (open a brief protection-allow window, or run from an authenticated context) and **2.5** (with the `verification-testing` bypass secret); then the manual **2.6** smoke sequence. Also confirm the **Level A — Application OTP end-to-end** checks from [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) §5: a real OTP to an approved recipient completes login, and expired/reused OTPs are rejected, retry and send-limit behavior hold, and no message is sent to an unapproved recipient.
- **Value/confirmation needed:** verify-deployment all-PASS; `/api/health` 200 `status=ok`; smoke sequences pass; Level A OTP checks pass.
- **Do NOT paste:** the verification bypass secret, OTP codes, or any recipient number.
- **Safe confirmation to return:** *"verify-deployment: 3× PASS; /api/health=200 ok; smoke Customer/Provider/Admin pass; Level A OTP pass."*

At J-complete, Stage 1's exit criteria are met (on **Level A** OTP) and the environment is ready for the Stage 2 exercises (DR Drill, Load Test, Security Scan → Go/No-Go items 4–10). **Level B (Oman `+968` delivery) remains a separate production-readiness gate** — see the blocker below.

---

## 4. First Action & Blockers

**First action the owner must perform:** **Step A — Supabase creation** (create the project, choose region, obtain the **session-pooler (5432)** connection string). Everything else chains from a validated database endpoint.

**Safe confirmation expected back from that first action:** *"Supabase project created in `<region>`; session-pooler (5432) connection string obtained (not shared); SSL required."* — then proceed to Step B validation.

**Blockers / watch-items:**
- **Twilio LIVE staging credentials (Form #6–9) are still pending from the owner.** The first deploy (Step E) will **fail** `validate-env` if `OTP_PROVIDER=twilio` without all three Twilio values. **Test Credentials are unsuitable** (simulation-only, cannot deliver). Not needed until Step D, but must be in hand by then.
- **🚫 PRODUCTION BLOCKER — Oman delivery (Level B).** Production launch is **blocked** until real `+968` SMS delivery and Oman sender-compliance requirements have been verified (Messaging Geographic Permissions, sender eligibility, Alphanumeric Sender ID registration with Omantel/Ooredoo, delivery across required carriers). Staging sign-off requires only **Level A**; do **not** assume `+968` delivery is ready. See [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) §5's two-level model.
- **`verify-deployment.ts` cannot carry a bypass header** — Step J needs a brief protection-allow window or an authenticated context. Not a code change (out of scope).
- **DNS for `staging.barq.om`** — if not yet available (Form #5), Step H is deferred and staging runs on the Vercel-generated domain; the `*_URL` env vars must match whichever domain is live, and switching later requires a redeploy.
- **Session-mode connection ceiling** — Step B records `max_connections`; the Stage 2 Load Test will confirm it's adequate under Vercel serverless fan-out. Informational, not blocking now.
