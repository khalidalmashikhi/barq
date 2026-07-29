# BARQ — Staging Deployment Checklist

Produced by the Code Freeze / Operational Validation phase. Scope: a **staging** environment only — an isolated environment used to run the Disaster Recovery Drill, Load Test, and Security Scan documented alongside this file. Nothing here authorizes or describes a production deploy; see [`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) for that. No step in this checklist has been executed by this phase — it is the plan an operator follows, not a record of actions taken.

---

## 1. Vercel

- [ ] Create a **separate Vercel project** (or a distinct Preview/Staging environment within the existing project, with its own environment-variable scope) — never point staging at the production project's environment variables.
- [ ] Set the Build Command to `npm run vercel-build`, identical to production, so the exact same `validate-env → prisma migrate deploy → next build` chain is what gets exercised in staging.
- [ ] Confirm the staging deployment does not share a Vercel Cron schedule with production if both exist simultaneously (or accept that the cron job runs against the staging database only, which is the intended, harmless case since `expire-stale-bookings` only touches staging's own `Booking` rows).

## 2. Isolated Staging PostgreSQL Database

- [ ] Provision a **physically separate** Postgres database/instance — never a schema or namespace inside the production database, and never the same instance as any developer's local `.env` database.
- [ ] Confirm the staging database starts empty (or from a known, deliberately-seeded baseline — see §8) so migration behavior is observable from a clean state, matching what the first real production deploy will also do.
- [ ] Confirm the staging database is disposable — the entire point of this environment is that the Disaster Recovery Drill (destructive restore testing) and Load Test (write-heavy booking creation) can run against it without any risk to real data, because none exists there.

## 3. Pooled `DATABASE_URL`

- [ ] Use the provider's **pooled** connection endpoint (PgBouncer/pooler — Neon, Supabase, and Vercel Postgres all expose one), not a direct connection — this validates the exact configuration recommended for production in [`DEPLOYMENT_PREPARATION`](../project-memory/12-DECISIONS.md)-adjacent guidance (see the prior Production Deployment Preparation report's §4 note on Prisma + serverless connection exhaustion).
- [ ] Confirm the pooled connection string's mode (transaction vs. session pooling) is compatible with Prisma's own requirements for the provider chosen — check the specific provider's Prisma-compatibility documentation before assuming the default pooling mode works.
- [ ] This is the correct environment to actually prove the pooling recommendation works under concurrent load — the Load Test Plan's §6 (Database Pressure) metric depends on this being configured correctly here first.

## 4. Staging Secrets

- [ ] Generate fresh, staging-only values for `BETTER_AUTH_SECRET` and `CRON_SECRET` — never copy a production secret into staging (a staging environment is reasonably assumed to have broader team access) and never reuse a local-dev value.
- [ ] Set `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` to the real staging domain (§6) — not `localhost`, not the production domain.
- [ ] Set `NODE_ENV=production` for the staging deployment itself (Vercel does this automatically for any deployed — not `next dev` — instance) so the same production-only `env-schema.ts` validation rules that will gate the real production deploy are genuinely exercised here first.
- [ ] `PAYMENT_PROVIDER=NONE` in staging, matching the current, approved launch state — do not activate Stripe test mode as part of this validation pass unless a separately approved payment-activation phase says otherwise.

## 5. Twilio OTP Configuration

BARQ uses **Twilio Programmable Messaging** (it generates the OTP and sends it as an SMS body) — **not Twilio Verify, not a Messaging Service SID**. Exact variables: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `OTP_CHANNEL`.

- [ ] `OTP_PROVIDER=twilio`, `OTP_CHANNEL=sms` in staging, with **LIVE** credentials from a **separate staging Twilio project/subaccount** — **never** production's credentials or sender. **Twilio Test Credentials are simulation-only and MUST NOT be used**: they never connect to a real phone (only magic numbers), so they **cannot deliver a real OTP or exercise the flow end-to-end**. Trial live credentials are acceptable **only if actual handset delivery to an approved recipient succeeds**.
- [ ] For any real delivered OTP (confirming actual end-user delivery works), use exactly one or two **team-controlled, approved** recipient numbers (Verified Caller IDs if on a trial account) — never a broad or random set, and never an unapproved recipient.
- [ ] Run the **Level A — Application OTP end-to-end** checks in [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) §5 (API succeeds → SMS reaches handset → login completes; expired/reused rejected; retry + send-limit verified; no send to unapproved recipient).
- [ ] **Level B — Oman `+968` delivery readiness is a separate PRODUCTION-READINESS gate, not part of staging sign-off.** Do **not** assume `+968` delivery is ready: Messaging Geographic Permissions, sender eligibility, Alphanumeric Sender ID registration (Omantel/Ooredoo), and per-carrier delivery must all be verified before production. A successful Twilio API acceptance does **not** prove handset delivery; trial verification does **not** prove Omani carrier compatibility.
- [ ] **[`LOAD_TEST_PLAN.md`](LOAD_TEST_PLAN.md) §2 must not trigger real OTP sends at all** — see that document's own explicit mitigation (pre-authenticated session reuse, not per-VU login).

## 6. Staging Domain

- [ ] Use a distinct subdomain (e.g. `staging.barq.om` or the Vercel-issued preview URL) — never a production-look-alike domain that could be mistaken for the real site by a real user or by a search engine crawler.
- [ ] Keep staging non-public via **Vercel Deployment Protection** (see [`STAGING_EXECUTION_GUIDE.md`](STAGING_EXECUTION_GUIDE.md) **D-2**) — do **not** require a `robots.txt` `Disallow: /` change; `robots.ts` has no per-environment branch and cannot express that without an application change (out of scope).
- [ ] HTTPS/TLS must still be genuinely configured on staging (Vercel issues this automatically once the domain is attached) — the Security Scan Plan's TLS verification (§6 of that document) depends on this being real, not skipped because "it's only staging."

## 7. Monitoring

- [ ] Point the same external uptime monitor (or a staging-specific instance of it) at the staging `/api/health` endpoint before running the Load Test — this is how the Load Test Plan's own health-check assertions get corroborated by an independent, external signal, not just the load-test tool's own view of response codes.
- [ ] Confirm staging's structured logs (`src/lib/logger.ts` output) are reviewable during and after the drill/load-test/scan — at minimum via Vercel's own function-log viewer for the staging deployment.

## 8. Test Users for Customer, Provider, and Admin Roles

- [ ] **Customer**: at least one real test phone number that can complete OTP login end-to-end in staging (auto-provisions a Customer row on first sign-in, per the existing self-service flow — no manual seeding needed for this one).
- [ ] **Provider**: apply as a Provider through the real self-service `apply-as-provider` flow using a second real test phone number, then use the Admin test account (below) to run the real `approveProvider` action — do not hand-insert an `APPROVED` Provider row directly into the database, since that would leave the real approval-workflow code path unexercised by this validation pass.
- [ ] **Admin**: run `npx tsx scripts/bootstrap-admin.ts <staging-test-phone-number>` once against the staging database, after that phone number has signed in at least once normally — this is the only supported way to create the first Admin, by design (see the script's own comment: no HTTP-reachable "become admin" path exists, deliberately).
- [ ] Record the three test identities (phone numbers only, never real personal data beyond what a real test account needs) somewhere the team running the Disaster Recovery Drill / Load Test / Security Scan can reference them — they are reused across all three exercises, not re-created each time.
