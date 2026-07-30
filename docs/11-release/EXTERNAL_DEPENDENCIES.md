# BARQ — External Dependencies & Production Launch Blockers

# Purpose

This document is the **single source of truth for every dependency that lives outside the BARQ Git repository** — infrastructure, third-party services, secrets, domains, ownership, and compliance obligations.

None of these can be verified by TypeScript, ESLint, the test suite, or the production build. Those gates prove the *code* is correct; they say nothing about whether a Supabase database exists, whether Twilio can actually deliver an SMS to an Omani handset, whether DNS resolves, or who is on call. Everything here must be confirmed **operationally**, against a real dashboard or a real deployed instance.

**Conventions:**
- **`OWNER INPUT REQUIRED`** — a value or confirmation the repository cannot supply; the owner must provide it. Never invented here.
- Cross-references point to the existing `docs/11-release/` documents rather than duplicating their content. This document consolidates; it does not replace them.
- Repository is the source of truth. No infrastructure, owner, or capability is asserted here that isn't evidenced by a repository file or an explicit approved decision from this provisioning effort.

Related existing documents (not duplicated): [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md), [`STAGING_PROVISIONING_RUNBOOK.md`](STAGING_PROVISIONING_RUNBOOK.md), [`STAGING_PROVISIONING_PREP.md`](STAGING_PROVISIONING_PREP.md), [`STAGING_ENV_TEMPLATE.md`](STAGING_ENV_TEMPLATE.md), [`STAGING_DEPLOYMENT_CHECKLIST.md`](STAGING_DEPLOYMENT_CHECKLIST.md), [`GO_NO_GO_CHECKLIST.md`](GO_NO_GO_CHECKLIST.md), [`RELEASE_CANDIDATE_SUMMARY.md`](RELEASE_CANDIDATE_SUMMARY.md), [`../07-infrastructure/PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md).

---

# Infrastructure

### Vercel (hosting)
- **Purpose:** Hosts the Next.js app; runs `vercel-build`, serverless functions, and the cron job.
- **Current status:** Production project — `OWNER INPUT REQUIRED`. Staging — approved as a separate **Pro** project `barq-staging` (not yet created; see the runbook).
- **Repository dependency:** `vercel.json` (cron), `package.json` `vercel-build` script, `engines.node >=20`.
- **Owner:** Deployment owner — `OWNER INPUT REQUIRED` (`PRODUCTION_RUNBOOK.md` §12 is a placeholder table).
- **Verification method:** Project builds with Build Command `npm run vercel-build`; `scripts/verify-deployment.ts` PASS against the deployed URL.
- **Production blocker?** **Yes** — no production deploy target is confirmed.

### Supabase (PostgreSQL)
- **Purpose:** The application database (Prisma → PostgreSQL).
- **Current status:** Staging — Supabase two-URL model: `DATABASE_URL` = **Transaction pooler, port 6543** (`pgbouncer=true&connection_limit=1`) for the app; `DIRECT_URL` = **Session pooler, port 5432** for migrations. `prisma/schema.prisma` declares `url` + `directUrl` (revised after a runtime session-pool exhaustion fix — see `STAGING_EXECUTION_GUIDE.md` D-1). Production DB — `OWNER INPUT REQUIRED`.
- **Repository dependency:** `prisma/schema.prisma` datasource `url = env("DATABASE_URL")`; `prisma migrate deploy` inside `vercel-build`; `src/lib/observability/check-database-health.ts` (`SELECT 1`).
- **Owner:** `OWNER INPUT REQUIRED`.
- **Verification method:** D-1 acceptance test — `prisma migrate deploy` + `prisma migrate status` against the session-pooler URL (runbook §2.3). Health endpoint reports `database=ok`.
- **Production blocker?** **Yes** — no production database is provisioned.

### DNS
- **Purpose:** Resolves the staging/production domains to Vercel.
- **Current status:** `staging.barq.om` — `OWNER INPUT REQUIRED` (Form #5: DNS access unconfirmed; fallback = Vercel-generated domain). Production domain DNS — `OWNER INPUT REQUIRED`.
- **Repository dependency:** `NEXT_PUBLIC_APP_URL` (drives `metadataBase`, canonical/hreflang, `robots.ts`, `sitemap.ts` via `getAppUrl()`).
- **Owner:** `OWNER INPUT REQUIRED`.
- **Verification method:** Domain resolves; Vercel domain verification succeeds.
- **Production blocker?** **Yes** for the intended custom production domain (staging can fall back to the Vercel domain).

### SSL/TLS
- **Purpose:** HTTPS for all traffic; required for secure cookies and the Security Scan (`SECURITY_SCAN_PLAN.md` §4–§5).
- **Current status:** Auto-issued by Vercel once a domain is verified — no repository action. Not yet exercised (no environment deployed).
- **Repository dependency:** Better Auth `secure` cookie behavior keys off `https://` origin / `NODE_ENV=production` (`src/lib/auth/server.ts`).
- **Owner:** Vercel (automatic) / Deployment owner `OWNER INPUT REQUIRED`.
- **Verification method:** `curl -I https://<domain>` shows a valid certificate; Security Scan TLS checks pass.
- **Production blocker?** **Yes** (implicitly, via the domain) — cannot pass the Security Scan without it.

### Backups
- **Purpose:** Point-in-time recovery / snapshots; prerequisite for the Disaster Recovery Drill (`DISASTER_RECOVERY_DRILL.md`, Go/No-Go item 4).
- **Current status:** `OWNER INPUT REQUIRED` — a Supabase-dashboard capability, not verifiable from the repository. Backup **retention period** also `OWNER INPUT REQUIRED` (see Compliance).
- **Repository dependency:** None directly; the DR Drill procedure depends on it operationally.
- **Owner:** `OWNER INPUT REQUIRED`.
- **Verification method:** Confirm PITR/snapshots enabled in the provider dashboard; a test restore succeeds during the DR Drill.
- **Production blocker?** **Yes** — a production database without verified backups/restore is not launch-ready.

### Monitoring
- **Purpose:** External uptime/alerting on `/api/health`.
- **Current status:** Vendor approved: **Better Stack** (staging). Not yet configured. Production monitoring — Go/No-Go item 13, `OWNER INPUT REQUIRED`.
- **Repository dependency:** `src/app/api/health/route.ts` (200/503 contract); structured logs via `src/lib/logger.ts`.
- **Owner:** Monitoring owner — `OWNER INPUT REQUIRED`.
- **Verification method:** Better Stack shows `/api/health` UP (200) and a test alert fires (runbook Step G).
- **Production blocker?** **Yes** — Go/No-Go item 13 must be live before launch.

### Cron Jobs
- **Purpose:** `expire-stale-bookings` every 30 minutes.
- **Current status:** Declared in `vercel.json` (`*/30 * * * *`). Runs automatically on any Vercel deploy **on Pro** (staging is Pro). Authenticated by `CRON_SECRET`.
- **Repository dependency:** `vercel.json`; `src/app/api/cron/expire-stale-bookings/route.ts` (checks `CRON_SECRET` bearer).
- **Owner:** Deployment owner — `OWNER INPUT REQUIRED`.
- **Verification method:** Confirm `CRON_SECRET` set; cron invocation returns 200 (not 401) in Vercel logs.
- **Production blocker?** **Conditional** — not a hard blocker, but stale bookings won't expire without `CRON_SECRET` set on the production project.

### Deployment Protection
- **Purpose:** Keep **staging** non-public (Vercel auth/password); production is intentionally public.
- **Current status:** Staging — approved ON, with **two** automation bypass secrets (monitoring, verification) — Vercel supports multiple bypass secrets. Not yet configured. Production — protection **OFF** by design (public marketplace).
- **Repository dependency:** None (platform-level); interacts with `src/app/robots.ts` (which has no per-environment branch — staging privacy comes from protection, not `robots.txt` — decision D-2).
- **Owner:** Deployment owner — `OWNER INPUT REQUIRED`.
- **Verification method:** Unauthenticated staging request returns 401; bypass-secret header returns 200 (runbook Steps F–G).
- **Production blocker?** **No** for production (deliberately off); required for **staging** sign-off.

---

# Third-Party Services

### Twilio
- **Required configuration:** **Twilio Programmable Messaging** (REST Messages API). BARQ generates the OTP itself and sends it as an SMS body — **not Twilio Verify, not a Messaging Service SID**. `OTP_PROVIDER=twilio`, `OTP_CHANNEL=sms`. Staging must use **live** credentials from a **separate staging project/subaccount**; production uses separate real production credentials.
- **Secrets required:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. (`OTP_CHANNEL` is non-secret.) `OWNER INPUT REQUIRED` — supplied directly to Vercel, never pasted into docs/chat.
- **Test method:** The **two-level model** in [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) §5 — **Level A** (application OTP E2E to a team-controlled approved recipient) for staging; **Level B** (real `+968` delivery + Oman sender compliance) for production. **Twilio Test Credentials are simulation-only and cannot deliver a real OTP.**
- **Production readiness criteria:** Level B passes — real `+968` handset delivery verified, Messaging Geographic Permissions for Oman enabled, sender eligibility + Alphanumeric Sender ID registration (Omantel/Ooredoo) complete, per-carrier delivery confirmed (Go/No-Go item 16).

### Better Stack
- **Required configuration:** Uptime monitor on `https://<domain>/api/health`; on staging, a custom request header `x-vercel-protection-bypass: <monitoring bypass secret>`; alert destination set.
- **Secrets required:** Vercel monitoring bypass secret (staging only) — `OWNER INPUT REQUIRED`; Better Stack account/API — `OWNER INPUT REQUIRED`.
- **Test method:** Monitor reports 200/UP; test alert fires to the destination (runbook Step G).
- **Production readiness criteria:** Production `/api/health` monitored with alerting confirmed firing (Go/No-Go item 13).

### Email provider
- **Required configuration:** **None — not integrated.** Repository search confirms no email-sending code (no nodemailer/SendGrid/Resend/SMTP). The `Notification` model's channel enum includes `EMAIL`, and Better Auth carries a nullable, never-collected `email` field, but **no email delivery path exists**.
- **Secrets required:** None.
- **Test method:** N/A.
- **Production readiness criteria:** N/A — **not a launch dependency.** (Would become one only if an email feature is ever built and approved.)

### Future payment provider (currently `PAYMENT_PROVIDER=NONE`)
- **Required configuration:** None for launch. `PAYMENT_PROVIDER=NONE` (the approved launch state) resolves every payment call to the safe no-op provider that cannot move money. Stripe (`PAYMENT_PROVIDER=STRIPE`) is **out of scope** for every phase to date.
- **Secrets required:** None while `NONE`. `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` would be required only if Stripe is later activated (deliberately excluded from the staging env template).
- **Test method:** N/A at launch; smoke test confirms payment state renders as `INITIATED`-shaped, never a fabricated "paid" claim (`SMOKE_TEST_GUIDE.md`).
- **Production readiness criteria:** N/A for this launch. Activation requires a separately approved payment phase.

---

# Security

- **Secret generation:** `BETTER_AUTH_SECRET` (≥32 chars) and `CRON_SECRET` generated fresh per environment — `openssl rand -base64 32` (or the PowerShell equivalent in runbook §2.2). Never reuse a local/CI/production value. Enforced by `scripts/env-schema.ts`.
- **Secret rotation:** `OWNER INPUT REQUIRED` — no automated rotation exists in the repository. Vercel supports multiple automation bypass secrets (rotatable independently). Rotation policy/cadence for `BETTER_AUTH_SECRET`, `CRON_SECRET`, and Twilio credentials must be owner-defined.
- **MFA:** `OWNER INPUT REQUIRED` — enable MFA on all provider accounts (Vercel, Supabase, Twilio, Better Stack, DNS registrar). Not repository-controllable.
- **Owner accounts:** `OWNER INPUT REQUIRED` — the human/organization accounts owning each provider above.
- **Emergency access:** `OWNER INPUT REQUIRED` — `PRODUCTION_RUNBOOK.md` §12 emergency-contact table is a placeholder (Go/No-Go item 14, "Not yet run").
- **Least privilege:** Application-level RBAC is code-controlled (`src/lib/auth/rbac.ts`, `requireAdmin()` on every admin action). Provider-account least privilege (scoped Vercel/Supabase/Twilio roles) — `OWNER INPUT REQUIRED`. Staging uses separate credentials/senders from production by mandate.
- **Audit logging dependencies:** Application audit trail is in-database (`AuditLog`, `BookingStatusEvent`, `BookingContractEvent`) — write-only today, **no external dependency**. Operational/log aggregation currently relies on Vercel's built-in function logs (`src/lib/logger.ts`); any external log-retention/SIEM vendor is `OWNER INPUT REQUIRED`.

---

# Domain & Networking

- **Production domain:** `OWNER INPUT REQUIRED` — apex `barq.om` is implied by the approved `staging.barq.om` subdomain but **not confirmed in the repository**; confirm the exact production origin and set `NEXT_PUBLIC_APP_URL`/`BETTER_AUTH_URL`/`NEXT_PUBLIC_BETTER_AUTH_URL` to it.
- **Staging domain:** `staging.barq.om` (approved), or the Vercel-generated domain if DNS isn't ready (Form #5).
- **DNS ownership:** `OWNER INPUT REQUIRED` — who controls the `barq.om` zone.
- **HTTPS:** Auto-issued by Vercel per domain; required for the Security Scan and secure cookies.
- **Redirect policy:** `OWNER INPUT REQUIRED` — apex/`www` canonicalization and any http→https handling beyond Vercel's automatic upgrade are not defined in the repository.
- **Health endpoint exposure:** `/api/health` is **public and unauthenticated by design** (returns only status strings + version, never secrets — `src/app/api/health/route.ts`). Public in production; reachable in protected staging only via a bypass secret.
- **Deployment protection:** Staging ON (D-2); production OFF (public site).
- **Monitoring bypass:** Two Vercel automation bypass secrets on staging (monitoring, verification) — never placed in source control or `NEXT_PUBLIC_*` variables.

---

# Operations

All operational roles below are placeholders in `PRODUCTION_RUNBOOK.md` §12 — the repository does not name people. Each is **`OWNER INPUT REQUIRED`** and must be filled before launch (Go/No-Go item 14).

- **Rollback owner:** `OWNER INPUT REQUIRED` — executes Vercel instant redeploy-previous (`PRODUCTION_RUNBOOK.md` §6–§7).
- **Deployment owner:** `OWNER INPUT REQUIRED`.
- **Monitoring owner:** `OWNER INPUT REQUIRED`.
- **Incident owner:** `OWNER INPUT REQUIRED`.
- **On-call contact:** `OWNER INPUT REQUIRED`.
- **Release approval owner:** `OWNER INPUT REQUIRED` — signs the Go/No-Go decision.

---

# Compliance

- **Oman SMS readiness:** `OWNER INPUT REQUIRED` — real `+968` handset delivery must be verified (Twilio Level B; Go/No-Go item 16). **Production blocker.**
- **Sender registration:** `OWNER INPUT REQUIRED` — Alphanumeric Sender ID pre-registration with Omantel/Ooredoo (documented external process). **Production blocker.**
- **Geographic permissions:** `OWNER INPUT REQUIRED` — Twilio Messaging Geographic Permissions must allow Oman. **Production blocker.**
- **Privacy Policy:** Page exists (`/privacy`, in `sitemap.ts`). **Legal content review — `OWNER INPUT REQUIRED`** (the repository does not attest legal sufficiency).
- **Terms of Service:** Page exists (`/terms`). Legal content review — `OWNER INPUT REQUIRED`. (Related pages present: `/cookies`, `/booking-policy`.)
- **Data retention:** `OWNER INPUT REQUIRED` — no data-retention policy is defined in the repository (`CONTRACT_SIGNATURE_LOG_IP` toggles signer-IP capture, but there is no retention/erasure schedule).
- **Backup retention:** `OWNER INPUT REQUIRED` — provider-dashboard setting; retention window must be chosen and documented.

---

# Launch Blockers

Populated only with repository-supported information. "Blocking Production" = must be resolved before a real production launch.

| Dependency | Status | Blocking Production | Owner | Verification |
|---|---|---|---|---|
| Vercel production project | Not created | **Yes** | OWNER INPUT REQUIRED | `verify-deployment.ts` PASS |
| Supabase production DB (session pooler) | Not created | **Yes** | OWNER INPUT REQUIRED | `migrate status` clean; `database=ok` |
| Production domain + DNS | Not configured | **Yes** | OWNER INPUT REQUIRED | Domain resolves; Vercel verified |
| SSL/TLS (production) | Pending domain | **Yes** | Vercel / OWNER INPUT REQUIRED | Valid cert; Security Scan TLS pass |
| Database backups + test restore | Unverified | **Yes** | OWNER INPUT REQUIRED | DR Drill restore passes (item 4) |
| Production monitoring + alerting | Not configured | **Yes** | OWNER INPUT REQUIRED | Go/No-Go item 13 |
| Production env vars / real secrets | Not set | **Yes** | OWNER INPUT REQUIRED | `NODE_ENV=production validate-env` passes |
| Twilio production credentials | Not supplied | **Yes** | OWNER INPUT REQUIRED | `otpProvider=twilio`; Level A pass |
| Oman `+968` SMS delivery (Level B) | Not verified | **Yes** | OWNER INPUT REQUIRED | Real handset delivery (item 16) |
| Oman sender registration + geo permissions | Not verified | **Yes** | OWNER INPUT REQUIRED | Twilio console + carrier confirmation |
| Emergency contacts / operational owners | Placeholder | **Yes** | OWNER INPUT REQUIRED | `PRODUCTION_RUNBOOK.md` §12 filled (item 14) |
| DR Drill / Load Test / Security Scan executed | Not run | **Yes** | OWNER INPUT REQUIRED | Go/No-Go items 4–10 |
| `CRON_SECRET` on production | Not set | Conditional | OWNER INPUT REQUIRED | Cron returns 200 not 401 |
| MFA on provider accounts | Unknown | Recommended | OWNER INPUT REQUIRED | Provider dashboards |
| Secret rotation policy | Undefined | Recommended | OWNER INPUT REQUIRED | Documented policy |
| Privacy/Terms legal review | Pages exist; unreviewed | Recommended | OWNER INPUT REQUIRED | Legal sign-off |
| Data retention + backup retention policy | Undefined | Recommended | OWNER INPUT REQUIRED | Documented policy |
| Email provider | Not integrated | No | — | N/A (no email path exists) |
| Payment provider (Stripe) | `PAYMENT_PROVIDER=NONE` | No | — | Out of scope for launch |
| Staging Vercel project (Pro) | Not created | No (staging) | OWNER INPUT REQUIRED | Staging runbook |
| Staging Deployment Protection + bypass secrets | Not configured | No (staging) | OWNER INPUT REQUIRED | 401 unauth / 200 with bypass |

---

# Launch Readiness Summary

**Production launch: BLOCKED.**

Every production-gating dependency in the table above is currently unmet — and by design: no cloud resource has been created in any stage of this effort. Specifically, production is blocked because:
1. **No production infrastructure exists** — Vercel production project, Supabase production DB, domain/DNS, SSL, and backups are all unprovisioned or unverified.
2. **The Go/No-Go operational gates (items 4–16) have not been executed** — DR Drill, Load Test, Security Scan, monitoring, emergency contacts, and Oman OTP delivery are all "Not yet run."
3. **Oman SMS delivery (Level B) is unverified** — a hard, compliance-driven blocker (geo permissions + sender registration + real `+968` delivery). A successful Twilio API call does not prove handset delivery.
4. **Operational ownership is unassigned** — every rollback/deploy/monitoring/incident/on-call/approval role is a placeholder.

**Staging: READY WITH CONDITIONS.** The repository side is fully prepared and requires no code or schema change (build chain, env schema, health endpoint, verification script, admin bootstrap, robots/sitemap all in place). Staging can proceed the moment the owner supplies the outstanding inputs (live Twilio staging credentials, Supabase session-pooler, Vercel Pro project, DNS-or-fallback domain, Better Stack, test phone numbers) and provisions per [`STAGING_PROVISIONING_RUNBOOK.md`](STAGING_PROVISIONING_RUNBOOK.md). Staging sign-off requires only **Level A** OTP; **Level B remains a separate production gate.**

**The code is not the blocker.** The Release Candidate's quality gates are green (TypeScript clean, ESLint clean, 198 files / 1,345 tests, build ✓ — `RELEASE_CANDIDATE_SUMMARY.md`). Every remaining blocker is external/operational and owner-driven.
