# BARQ — Release Candidate Checklist

Produced by the Release Candidate / Code Freeze phase, following completion of all Phase A production-blocker remediation and the subsequent provider-deactivation authorization gap closure. This document is scoped exactly to the 11 areas the Release Candidate mission named. It complements, and does not replace, the existing living checklists:

- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — the Go-Live Release Checklist (environment/migration/health/OTP/payment/sitemap/robots/SEO/localization/smoke-test verification steps, item by item)
- [`SMOKE_TEST_GUIDE.md`](SMOKE_TEST_GUIDE.md) — the full Customer/Provider/Admin smoke-test script
- [`../05-trust-and-compliance/PRODUCTION_SECURITY_CHECKLIST.md`](../05-trust-and-compliance/PRODUCTION_SECURITY_CHECKLIST.md) — security-specific gate
- [`../07-infrastructure/PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) — operational runbook (incident response, rollback mechanics)
- [`../07-infrastructure/ENVIRONMENT_AUDIT.md`](../07-infrastructure/ENVIRONMENT_AUDIT.md) — full variable-by-variable environment reference

Where this document names a check already covered in more depth by one of those files, it links out rather than duplicating the detail.

---

## 1. Production Environment Variables

- [ ] Every variable in [`scripts/env-schema.ts`](../../scripts/env-schema.ts) is set in the real target environment (not copied from local `.env` or CI placeholders) — cross-check against [`ENVIRONMENT_AUDIT.md`](../07-infrastructure/ENVIRONMENT_AUDIT.md) and `.env.example`.
- [ ] `NODE_ENV=production` is set by the hosting platform (Vercel sets this automatically) — this activates `env-schema.ts`'s production-only rules (`BETTER_AUTH_SECRET` ≥32 chars, `NEXT_PUBLIC_APP_URL` required, `OTP_PROVIDER` must not be `console`, `CRON_SECRET` required).
- [ ] `BETTER_AUTH_SECRET` is a real, randomly generated secret (e.g. `openssl rand -base64 32`) — not a value ever used in local development or CI.
- [ ] `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_BETTER_AUTH_URL` point at the real production domain, not `localhost`.
- [ ] `CRON_SECRET` is set and matches what `vercel.json`'s cron trigger will send.
- [ ] Run `NODE_ENV=production npm run validate-env` directly against the target environment's actual variables before first deploy — this is the authoritative gate, not a local run.

**Verified this phase**: `npx tsc --noEmit`, `npm run lint`, and the full test suite ran clean; `npx tsx scripts/validate-env.ts` passes against this repository's local `.env` (dev-shaped, `NODE_ENV` unset — production-only rules dormant, as designed). Confirmed via a live `next start` run (see §7) that the health endpoint correctly reports `"environment":"incomplete"` when `NODE_ENV=production` is set against dev-shaped values (`OTP_PROVIDER` unset → defaults to `console`, `NEXT_PUBLIC_APP_URL` unset) — proving the production-only validation path fires correctly. This is expected local-environment behavior, not a code defect; it is exactly what must be corrected by populating real production variables before deploy.

## 2. Database Migration

- [ ] `npx prisma migrate status` against the target production database reports a clean, expected state before deploying.
- [ ] `vercel-build` (which now runs `npm run validate-env && prisma migrate deploy && next build`, per the Phase A remediation fix) executes migrations before the new code serves any traffic.
- [ ] `npx prisma migrate status` again reports "Database schema is up to date" immediately after deploy.
- [ ] Confirm no migration in `prisma/migrations/` has been edited after being applied to any shared environment.

## 3. Backups and Point-in-Time Recovery (PITR)

- [ ] Confirm the production Postgres provider has automated daily backups enabled.
- [ ] Confirm PITR (point-in-time recovery) is enabled with a retention window appropriate to the business (not just daily snapshots) — required to recover from a bad migration or accidental data mutation between backups.
- [ ] Confirm at least one test restore has been performed (to a scratch database, not production) to validate the backup is actually restorable, not just present.
- [ ] Document the exact recovery procedure (provider console steps or CLI commands) in [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) if not already there.

**Status**: not independently verified this phase — this is an infrastructure/hosting-provider configuration step outside the application repository's own tooling, and must be confirmed against the actual database provider's dashboard before launch.

## 4. Monitoring and Alerting

- [ ] `GET /api/health` is wired into an external uptime monitor (polling interval, alert threshold, and on-call recipient all configured) — the endpoint itself is built and verified (see §7); the external monitor subscription is an operational step outside this repository.
- [ ] Structured server logs (via the shared `src/lib/logger.ts`) are shipped to a real log aggregator in production, not left to only the hosting platform's ephemeral console output.
- [ ] An alert fires on sustained non-2xx rates from `/api/health` and from the payment webhook endpoint specifically (highest-impact failure surface).
- [ ] Confirm `TECH_STACK.md`'s "Future" items (Sentry, OpenTelemetry) remain explicitly out of scope for this release — not silently expected to already be active.

**Status**: application-side logging/tracing (`withRequestTracing`, structured logger) is built and verified; the external monitoring subscription/alerting configuration itself is an operational step outside this repository's tooling and must be completed against the real hosting/monitoring provider before launch.

## 5. Domain, DNS, HTTPS

- [ ] Production domain DNS points at the hosting provider (Vercel) with the expected record type (A/CNAME per Vercel's own instructions).
- [ ] HTTPS certificate is issued and auto-renewing (Vercel manages this automatically once DNS is verified) — confirm the domain shows as "Valid Configuration" in the Vercel dashboard before go-live.
- [ ] Confirm HSTS (already implemented — see [`PRODUCTION_SECURITY_CHECKLIST.md`](../05-trust-and-compliance/PRODUCTION_SECURITY_CHECKLIST.md)) is served over the real domain, not just localhost/preview URLs.
- [ ] Confirm no preview/staging Vercel URL is left reachable in a way that bypasses production auth/environment configuration.

**Status**: not independently verified this phase — DNS/domain/certificate provisioning happens at the hosting-provider level, outside this repository, and must be confirmed against the real Vercel project settings before launch.

## 6. OTP Provider

- [ ] `OTP_PROVIDER=twilio` (or another real provider) is set in production — `console` is rejected by `env-schema.ts`'s production-only rule and would mean no OTP is ever actually delivered.
- [ ] `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` are real, environment-specific production credentials — not a value ever used in local dev/staging.
- [ ] A real test OTP is sent to a real test phone number against the deployed instance and confirmed received, per [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)'s OTP Verification section.
- [ ] Confirm server logs never show the `[DEV OTP]` console-provider marker in production output.
- [ ] Confirm the daily send-limit rate limiter (Phase 5.1) is active and its threshold is appropriate for real launch traffic, not a dev-tuned value.

**Status**: `console` remains the active local default (correct for this repository's own dev/test environment). Not yet configured for production — this is the single largest known external dependency blocking a real go-live, tracked here and in §8 of the final release summary below.

## 7. Payment Provider

- [ ] Confirm the intended launch state: `PAYMENT_PROVIDER=NONE` unless a separately approved payment-activation phase has occurred (per `RELEASE_CHECKLIST.md`'s existing guidance — no payment-activation phase has been approved as of this Release Candidate).
- [ ] If `PAYMENT_PROVIDER=STRIPE` is intended for this release, confirm `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are real production credentials and the webhook endpoint (`/api/webhooks/payments`) is registered with Stripe's real production webhook configuration, not a test-mode endpoint.
- [ ] `GET /api/health`'s `"paymentProvider"` field matches the intended value exactly before launch.

**Verified this phase**: with `PAYMENT_PROVIDER` unset locally (defaults to `NONE`), `checkPaymentProviderHealth()` correctly resolves to `"NONE"` — a valid, non-misconfigured state — confirmed by direct source read of [`check-payment-provider-health.ts`](../../src/lib/observability/check-payment-provider-health.ts).

## 8. Health Endpoint

- [ ] `GET /api/health` returns `200` with `"status":"ok"` once production environment variables are fully populated (see §1) — confirmed this phase that the endpoint correctly returns `503`/`"degraded"` when run under `NODE_ENV=production` against incomplete (dev-shaped) configuration, proving the check fires correctly rather than silently passing.
- [ ] `"database":"ok"` — confirmed this phase via a live request against the local database connection (real `SELECT 1` round trip, not just client construction).
- [ ] Confirm the endpoint remains public/unauthenticated by design (documented in the route's own comments) and never leaks a connection string, secret, or raw error detail — confirmed by source read: a failed DB check returns only the literal string `"error"`.

**Verified this phase**: endpoint reachable, correct shape (`status`/`database`/`otpProvider`/`paymentProvider`/`environment`/`version`/`timestamp`), correct 503 status code and `"degraded"` body on incomplete environment — all via a live `next start` production-build run against `http://localhost:3000/api/health` through `scripts/verify-deployment.ts`.

## 9. Smoke Tests

- [ ] Run the full [`SMOKE_TEST_GUIDE.md`](SMOKE_TEST_GUIDE.md) sequence (Customer, Provider, Admin journeys) against the real deployed production instance immediately after go-live — not only against a local/staging environment.
- [ ] Confirm `scripts/verify-deployment.ts` (health/robots/sitemap automated check) passes with `"status":"ok"` against the production URL, not just localhost.

**Status**: `scripts/verify-deployment.ts` itself is verified working correctly this phase (ran against a local production build — see §7 of the final release summary for exact output); it has not yet been run against a real deployed production URL, since none exists yet for this Release Candidate. Full manual smoke-test walkthrough against a live production deployment remains a post-deploy step.

## 10. Rollback Plan

- [ ] Confirm the rollback mechanism named in [`PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md) (Vercel's instant rollback to the previous deployment) is understood by whoever holds deploy access.
- [ ] Confirm that a rollback of application code does **not** automatically roll back an already-applied database migration — any migration in this release that is not purely additive (column drops, renames, non-nullable additions without a default) must have its own reviewed rollback/backfill plan before deploy, not just "redeploy the old build."
- [ ] Confirm the person performing the deploy knows the exact command/dashboard action to trigger a rollback before they start the deploy, not after an incident begins.

**Status**: this Release Candidate's own changes (the 6 Phase A fixes + the provider-deactivation gap closure) are additive-only at the schema level with one exception — the `Booking.status` compare-and-swap fix and the `Provider`-status RBAC checks touch no schema at all; no destructive migration is part of this release. Rollback of application code alone is sufficient for everything shipped in this Release Candidate.

## 11. Emergency Contacts

- [ ] Confirm an on-call/escalation contact list exists and is current (who to page for: application errors, database issues, payment provider incidents, OTP delivery failures, domain/DNS issues).
- [ ] Confirm the list is stored somewhere durable and accessible during an actual incident (not only in this repository) — e.g. the team's incident-management tool or a pinned internal document.
- [ ] Confirm hosting provider (Vercel), database provider, and OTP provider (Twilio) support/escalation channels are documented alongside the internal contact list.

**Status**: not established by this repository — this is an organizational/operational artifact that must be created and maintained outside the codebase before go-live. Flagged here as an explicit open item, not fabricated.

---

## Summary of Verified vs. Operational-Only Items

| # | Area | Verified in this repository/phase | Requires external/operational action before go-live |
|---|---|---|---|
| 1 | Production environment variables | Schema + validation logic verified | Yes — real secrets must be set |
| 2 | Database migration | Mechanism verified (`vercel-build` chain) | Run against real target DB |
| 3 | Backups/PITR | — | Yes — hosting-provider configuration |
| 4 | Monitoring/alerting | App-side logging/tracing verified | Yes — external monitor subscription |
| 5 | Domain/DNS/HTTPS | — | Yes — hosting-provider DNS/cert setup |
| 6 | OTP provider | Console provider verified (dev-correct); Twilio path built & tested | Yes — real Twilio production credentials |
| 7 | Payment provider | Health check logic verified for `NONE` state | Only if payment activation is separately approved |
| 8 | Health endpoint | Fully verified live | No — ready |
| 9 | Smoke tests | Script verified against local build | Yes — run against real production URL |
| 10 | Rollback plan | This release is additive-only, no destructive migration | Confirm deploy-access holder is briefed |
| 11 | Emergency contacts | — | Yes — organizational artifact, not code |
