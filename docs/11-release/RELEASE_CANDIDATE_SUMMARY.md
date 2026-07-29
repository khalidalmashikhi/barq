# BARQ — Release Candidate Summary

Produced by the Release Candidate / Code Freeze phase, immediately following completion of all Phase A production-blocker remediation (6/6 fixed) and the provider-deactivation authorization gap closure (the single remaining condition from the post-remediation independent audit). No application code was modified during this phase — this is a quality-gate re-run and documentation phase only, per the phase's own explicit scope.

## Release Candidate Status

**Release Candidate Approved with Operational Conditions.**

All code-level Critical, High-security, High-authorization, and High-data-integrity findings from both independent audit rounds are resolved and re-verified fresh in this phase. No new Critical issues were found. The remaining conditions are exclusively external/operational (real production secrets, hosting/DNS/monitoring configuration, backup verification, emergency contacts) — none require an application code change.

## Exact Test Totals

- **Test files**: 198 passed (198)
- **Individual tests**: 1,345 passed (1,345)
- **Duration**: 196.30s
- **TypeScript** (`npx tsc --noEmit`): clean, exit code 0, zero errors
- **Lint** (`npm run lint` → `eslint src/`): clean, zero errors/warnings

## Build Result

- **Production build** (`npm run build`): succeeded — `✓ Compiled successfully in 14.8s`. Full route manifest generated with the expected static (`○`)/dynamic (`ƒ`) split; both routes touched by the provider-deactivation gap fix (`/api/bookings/[id]/history`, `/api/contracts/[id]/download`) still correctly listed as dynamic API routes.
- **Deployment verification** (`scripts/verify-deployment.ts`, run against a live `next start` production-build instance on `localhost:3000` via the pre-existing `barq-prod` preview configuration):
  - `GET /robots.txt` — **PASS** (200 OK, `Sitemap:` directive present)
  - `GET /sitemap.xml` — **PASS** (200 OK, 304 entries)
  - `GET /api/health` — **FAIL** in this local run: `HTTP 503`, `status=degraded`, `database=ok`, `otpProvider=console`, `paymentProvider=NONE`, `environment=incomplete`

  This failure was independently root-caused this phase, not merely observed: `next start` sets `NODE_ENV=production` automatically, which activates `scripts/env-schema.ts`'s production-only validation rules against this repository's local, dev-shaped `.env` file. Two of those rules correctly fire — `OTP_PROVIDER` is unset locally (defaults to `console`, explicitly disallowed once `NODE_ENV=production`) and `NEXT_PUBLIC_APP_URL` is unset (required once `NODE_ENV=production`). `BETTER_AUTH_SECRET` (64 chars) and `CRON_SECRET` are both already present and valid. This is the health check functioning exactly as designed — it is correctly detecting that a real production deployment has not yet been configured with real secrets, not a code defect. It is expected to resolve to `200`/`"ok"` the moment real production environment variables (see the Release Candidate Checklist §1, §6) are set on the actual target deployment.

## Known Non-Blocking Risks

1. **Legacy i18n gap (pre-existing, documented since Phase F.4, not part of this Release Candidate's scope)**: prior to this session's Phase A remediation, 1,122 untranslated placeholder strings existed across `cs/de/fr/it/pl/ru`. All were translated as Phase A blocker #6 and are now covered by a permanent regression test (`src/lib/i18n/translation-completeness.test.ts`, 126 assertions). No known untranslated placeholder remains in the 8 supported locales' `auth`/`booking`/`common`/`dashboard`/`errors`/`provider`/`seo`/`services` namespaces.
2. **Known, deliberately-unfixed Arabic spelling inconsistency**: `messages/ar/landing.json` uses the incorrect "بارق" in 13 places; `messages/ar/common.json`'s `appName` correctly uses "برق". Tracked in `docs/project-memory/13-OPEN-QUESTIONS.md` for a dedicated content-correction pass — explicitly out of scope for this Release Candidate.
3. **ADR-0011 (API-first) vs. reality**: no `/api/v1/` versioning exists on any current endpoint. Documented as a pre-existing architectural drift in `docs/project-memory/13-OPEN-QUESTIONS.md`; does not block this release since no external API consumer contract exists yet, but should be closed before any external/partner API consumer is onboarded.
4. **ADR-0009 (Better Auth `AuthUser` model separation) remains in Draft v0.1**, not formally Approved, though the schema already implements it — a governance/documentation gap, not a functional one.

## External Dependencies

- **Twilio** (OTP delivery) — production account, phone number, and credentials not yet provisioned in any environment this session has access to. Required before real users can complete phone verification in production.
- **Stripe** (payment gateway) — not configured (`PAYMENT_PROVIDER=NONE` is the current, intended launch state; no payment-activation phase has been approved).
- **Vercel** (hosting, per ADR-0007) — deployment target; DNS/domain/HTTPS/cron configuration must be completed against the real Vercel project.
- **PostgreSQL provider** — backup/PITR configuration must be confirmed against the actual database hosting provider's dashboard; not verifiable from within this repository.
- **External uptime/log monitoring** — no specific vendor has been selected in this repository; `/api/health` is built and ready to be polled by whichever tool is chosen.

## Deployment Prerequisites

See [`RELEASE_CANDIDATE_CHECKLIST.md`](RELEASE_CANDIDATE_CHECKLIST.md) for the full itemized checklist across all 11 required areas. In priority order, the items that gate a real go-live:

1. Set real production environment variables (`BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL`, `CRON_SECRET`) on the actual Vercel production environment.
2. Provision and configure `OTP_PROVIDER=twilio` with real Twilio production credentials.
3. Confirm domain DNS/HTTPS is fully configured and verified in Vercel.
4. Confirm database backups + PITR are enabled and a test restore has been performed.
5. Wire `/api/health` into an external uptime monitor with alerting.
6. Establish and document an emergency-contact/escalation list outside this repository.
7. Run the full `SMOKE_TEST_GUIDE.md` sequence against the real deployed instance immediately after first production deploy.

## Rollback Readiness

This Release Candidate's entire changeset (Phase A's 6 fixes + the provider-deactivation gap closure) is **additive-only at the schema level** — no destructive migration (no column drop, rename, or new non-nullable column without a default) is part of this release. Application-code rollback via Vercel's instant redeploy-previous-version mechanism is sufficient on its own to fully reverse this release; no corresponding database rollback/backfill plan is required. The exact rollback mechanism is documented in [`../07-infrastructure/PRODUCTION_RUNBOOK.md`](../07-infrastructure/PRODUCTION_RUNBOOK.md).

## Repository State

Not committed. Not pushed. This entire session's work (Phase A remediation, both audit rounds, the gap closure, and this Release Candidate phase) remains uncommitted in the working tree, consistent with every prior phase's explicit "do not commit / do not push unless instructed" constraint.
