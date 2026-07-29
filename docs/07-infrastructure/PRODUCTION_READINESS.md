# BARQ Production Readiness

- **Purpose:** A practical, code-level companion to `DEPLOYMENT_AND_INFRASTRUCTURE.md`'s architectural principles — the concrete checklist an operator actually runs through before, during, and after a production deploy of the application as it exists today. This document does not restate that file's principles; it operationalizes them against the real, current codebase.
- **Scope:** Deployment checklist, required secrets, production environment expectations, startup verification, rollback checklist.
- **Out of Scope:** Vendor-specific deployment steps (this project's hosting platform is not fixed by this document), Payments/Wallet/Messaging/Admin readiness (those modules are not yet implemented — see `docs/08-governance/DEVELOPMENT_LOG.md` and the Phase D.2 audit report for the current implementation inventory).
- **Owner:** Whoever operates the next production deploy — keep this current as real deployment experience accumulates; it is a living checklist, not a one-time artifact.
- **Status:** Added Phase D.3 (Production Hardening); extended Phase 5.2 (Production Hardening — observability, audit logging, and operational resilience); extended again by the Production Hardening phase following the Production Launch Readiness inspection (rate limiting, extended health endpoint, explicit auth cookie configuration).

---

## 1. OTP Delivery — Resolved in Phase D.4, Requires Configuration

**As of Phase D.4 (Production OTP Integration), BARQ can deliver a real OTP in production — but only once configured.** `src/lib/auth/server.ts`'s `sendOTP` callback now delegates to a provider abstraction (`src/lib/otp/`; full detail in `OTP_PRODUCTION.md`) instead of the previous dev-only console callback that unconditionally threw in production. **Do not deploy to production with `OTP_PROVIDER` unset or `"console"`** — `scripts/validate-env.ts` already fails the build/start in that case, so this should surface long before a real deploy, but confirm `OTP_PROVIDER=twilio` (or another real provider) and its credentials are set for the target environment. See `OTP_PRODUCTION.md` §6 for the full deployment sequence.

## 2. Deployment Checklist

Run in order. Do not skip a step because a previous deploy succeeded without it — this list exists precisely because "it worked last time" is not the same as "it's actually verified."

1. **Confirm OTP delivery is configured for this deploy** (§1) — `OTP_PROVIDER` set to a real provider (not `console`) with its credentials. If not, do not proceed.
2. **Environment variables set** — see §3. Run `npm run validate-env` against the target environment's actual variables before deploying (not just locally against `.env`). `.github/workflows/ci.yml`'s "Validate production env shape" step (Phase 5.2) already catches a *schema* regression (a required variable dropped from `scripts/env-schema.ts`) on every PR — it uses placeholder values, so it cannot catch a *missing real value* in the actual target environment; this manual step still is what does.
3. **Database migrations applied**: `npx prisma migrate deploy` (production-safe — never `migrate dev`, which can prompt interactively and is meant for local development only) against the production database, *before* the new application code starts serving traffic. On Vercel specifically, set the project's **Build Command** to `npm run vercel-build` (Phase 5.2) — this runs `prisma migrate deploy && next build` automatically on every deploy, so this step can no longer be a forgotten manual one. Elsewhere, run it explicitly as its own step before the build.
4. **Build succeeds cleanly**: `npm run build` with `NODE_ENV=production` and the real production environment variables — not CI's placeholder values. A build that only succeeded against placeholders has not proven the real configuration works.
5. **Quality gates pass**: `npm run typecheck`, `npm run lint`, `npm run test` (the same gates `.github/workflows/ci.yml` already enforces on every PR to `main` — a production deploy should never ship code that hasn't passed these).
6. **Health check reachable**: after the new instance starts, `GET /api/health` returns `200` with `"status":"ok"`, `"database":"ok"`, `"otpProvider"` resolved to something other than `"misconfigured"`, `"paymentProvider"` resolved to something other than `"misconfigured"`, and `"environment":"ok"` before it's added to a load balancer's healthy pool. A `503` here means don't route traffic to it — see §5 and §7.
7. **Smoke-test the real, critical path** against the deployed instance directly (not through cached CDN state): sign-in (phone + OTP, using a real test number if the delivery provider supports one), browse `/services`, view a service detail page, and — if a Provider test account exists — the Provider Dashboard.
8. **Confirm security headers are present** on a live response (`curl -I` the deployed origin): `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. See §4 and `next.config.ts`'s own `headers()` function — the CSP is only emitted when `NODE_ENV=production`, so confirm the deployed process actually has that set.
9. **Confirm TLS is actually terminated correctly** wherever this deploys — the `Strict-Transport-Security` header this app sends is inert until the connection is genuinely HTTPS end-to-end; verify with the browser's own security panel, not just the header's presence.

## 3. Required Secrets and Variables

Names only — never record real values in this file, a commit, or a chat transcript. Full variable list and inline documentation: `.env.example` (kept in sync with `scripts/validate-env.ts`'s Zod schema — that schema is the actual source of truth for what's *required*; this list explains *why*).

| Variable | Required when | Purpose |
|---|---|---|
| `DATABASE_URL` | Always | PostgreSQL connection string (ADR-0006). Must point at the production database, on its own isolated instance/credential — never shared with Staging (`DEPLOYMENT_AND_INFRASTRUCTURE.md` §3's isolation principle). |
| `BETTER_AUTH_SECRET` | Always; **≥32 characters when `NODE_ENV=production`** (enforced by `scripts/validate-env.ts` since Phase D.3) | Signs Better Auth sessions. Generate fresh per environment — `openssl rand -base64 32` — never reuse Staging's or a local `.env`'s value. |
| `BETTER_AUTH_URL` | Always | Server-side base URL Better Auth validates callbacks against. Must be the real production origin. |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | Always | Same origin, browser-exposed for the Better Auth client. Must match `BETTER_AUTH_URL`. |
| `NEXT_PUBLIC_APP_URL` | Always; **enforced required when `NODE_ENV=production`** (Phase D.3) | Resolves `metadataBase` for every canonical/hreflang/Open Graph URL (`src/app/layout.tsx`). Silently defaults to `http://localhost:3000` if unset — in production this means every indexed URL search engines see is wrong. |
| `OTP_PROVIDER` | Always resolves to one; **must not be `console` in production** (enforced by `scripts/validate-env.ts` since Phase D.4) | Selects the OTP delivery vendor. See `OTP_PRODUCTION.md`. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | `OTP_PROVIDER=twilio` | Twilio credentials for real SMS/WhatsApp OTP delivery (Phase D.4). |
| `WHATSAPP_API_TOKEN` | Not yet consumed by any code path | Reserved; Phase D.4's WhatsApp support instead uses Twilio's WhatsApp Business channel (`OTP_CHANNEL=whatsapp`), not this token directly. |
| `OBJECT_STORAGE_*`, `LLM_GATEWAY_API_KEY`, `GOOGLE_MAPS_API_KEY` | Not yet consumed by any code path | Reserved for features not yet built (object storage, AI Agent, Maps). Do not set in production until the corresponding feature exists — an unused secret is still a secret that can leak. |

`scripts/validate-env.ts` runs automatically before both `npm run dev` and `npm run build` (`predev`/`prebuild` hooks) — a missing or malformed required variable fails the process immediately with a specific message, rather than surfacing later as an opaque Better Auth or Prisma runtime error. Run it explicitly against a candidate production environment before deploying: `NODE_ENV=production npm run validate-env`.

**Optional, Production Hardening**: `RATE_LIMIT_BOOKING_CREATE_MAX` / `RATE_LIMIT_BOOKING_CREATE_WINDOW_SECONDS` / `RATE_LIMIT_REVIEW_CREATE_MAX` / `RATE_LIMIT_REVIEW_CREATE_WINDOW_SECONDS` tune the per-customer rate limits on booking/review creation (`src/lib/rate-limit/`). Sensible defaults (20/hour each) apply if unset — never required.

## 4. Production Environment Expectations

- `NODE_ENV=production` must be set in the actual runtime/build environment (not only relied upon via `next build`'s own internal forcing) — this is what activates both the production-only environment-variable checks (§3) and the production-only Content-Security-Policy header (`next.config.ts`).
- HTTPS must terminate somewhere in front of this application (a platform's own edge/CDN, or a reverse proxy this project doesn't configure directly) — the app itself sends `Strict-Transport-Security` but does not itself terminate TLS.
- No environment shares a database, secret, or credential with another (`SECURITY.md` §3/§8, `DEPLOYMENT_AND_INFRASTRUCTURE.md` §3) — verify this explicitly for a new environment, don't assume it from naming convention alone.
- `npm ci` (not `npm install`) for a reproducible production install, matching `package-lock.json` exactly.

## 5. Startup Verification

After deploying, before routing real traffic to the new instance:

1. `GET /api/health` → expect `200`, `{"status":"ok","database":"ok","otpProvider":"twilio","paymentProvider":"NONE","environment":"ok",...}` (exact `otpProvider`/`paymentProvider` values depend on this deploy's own configuration — see §7). A `503` means at least one of `database`/`otpProvider`/`paymentProvider`/`environment` failed — the response body says which; `"database":"error"` specifically means the app started but cannot reach PostgreSQL — check `DATABASE_URL` and network/firewall rules first.
2. Confirm `npx prisma migrate status` against the production database reports "Database schema is up to date" — a mismatch here means a migration was missed or a schema drifted outside the normal `prisma migrate deploy` path.
3. Sign in with a real test account, confirm the session persists across a page reload and a role-appropriate redirect happens (Customer → `/dashboard`, Provider → their own dashboard).
4. Confirm the security headers from §2 step 8 are present.
5. Deliberately visit a non-existent path (e.g. `/en/this-should-not-exist`) and confirm the branded, translated 404 renders (`src/app/not-found.tsx`/`src/app/[locale]/not-found.tsx`) — not a raw framework default.
6. Confirm the session cookie carries `Secure`/`HttpOnly`/`SameSite=Lax` on a real HTTPS response (browser DevTools → Application → Cookies) — see §7's cookie note for why this should already be correct by construction, not something that needs a code change per deploy.

## 6. Rollback Checklist

1. **Application rollback**: redeploy the immediately-prior known-good build/image. This project has no custom rollback tooling — use whatever the hosting platform's own "redeploy previous version" mechanism is.
2. **Database migration rollback**: Prisma does not auto-generate a `down` migration. If the deploy being rolled back included a schema migration, a hand-written reverse migration is required *before* redeploying the prior application code, if that prior code is incompatible with the new schema shape — check `prisma/migrations/` for what changed. If the migration was purely additive (a new nullable column, a new index), the prior application version will simply ignore the new column/index and rollback is safe without a reverse migration. **Correction (Code Freeze / Operational Validation phase):** not every migration to date is additive — see `docs/11-release/CODE_FREEZE_CHECKLIST.md` §2 for the full, re-audited migration list, including three early migrations with genuine column drops and one with an enum-value data rewrite. Check that table, not this document's prior blanket claim, before assuming any specific migration's rollback is reverse-migration-free.
3. **Confirm `/api/health`** returns `200` again post-rollback before considering the incident resolved.
4. **Record what happened** — Phase 5.2 added a persistent, schema-backed `AuditLog` (see §8) covering admin/provider mutations (provider approvals, service publish/unpublish/archive, availability changes) and `BookingStatusEvent` already covers every booking status change — together these answer "what changed and who changed it" for anything the incident touched. Neither is an incident-tracking system in its own right (no severity, no resolution workflow) — still write the incident narrative down somewhere durable (even a plain doc), using the audit trail as supporting evidence, not a replacement for it.

## 7. Rate Limiting and Authentication Hardening (Production Hardening)

**Rate limiting**: `src/lib/rate-limit/rate-limiter.ts` protects booking and review creation (`createBooking`/`createReview`) with a per-customer, in-memory, fixed-window counter — no schema change, no third-party dependency (Redis/Upstash), per this phase's explicit constraints. **This is genuinely in-memory, not a global/durable limit** — each running instance enforces its own independent count, and state resets on cold start. On a platform running multiple concurrent serverless instances, the effective ceiling for one identity is `limit × (warm instances currently serving)`, not a strict global cap. Acceptable for its purpose (raising the cost of casual scripted abuse on two non-security-critical mutation paths), not a substitute for the pre-existing, database-backed OTP resend-cooldown/daily-send-limit (`src/lib/otp/`), which remains the security-critical rate control. Tuned via `RATE_LIMIT_*` env vars — see §3.

**Authentication cookie configuration**: `src/lib/auth/server.ts` now sets `advanced.useSecureCookies: process.env.NODE_ENV === "production"` explicitly. Verified directly against the installed Better Auth version's own source (`node_modules/better-auth/dist/cookies/index.mjs`):
- `httpOnly: true` — hardcoded by the library unconditionally. Already correct; nothing to configure.
- `sameSite: "lax"` — the library's own unconditional default, deliberately left as-is (matches BARQ's full-page-redirect OTP sign-in flow; `"strict"` would drop the cookie on some legitimate cross-site referred navigations with no added security benefit here).
- `secure` — a correctly configured production deploy (`BETTER_AUTH_URL` starting with `https://`) already resolved this to `true` before this phase, implicitly. The explicit `useSecureCookies` tie to `NODE_ENV` (the same production gate the CSP header and `OTP_PROVIDER` validation already use) makes this deterministic rather than dependent on the exact string shape of `BETTER_AUTH_URL` — a zero-behavior-change pin for a correctly configured deploy, and strictly safer for a misconfigured one.

Verify live per §5 step 6.

## 8. Operational Resilience (Phase 5.2)

The only scheduled job in this codebase is `src/app/api/cron/expire-stale-bookings/route.ts` (Vercel Cron, every 30 minutes per `vercel.json`). Two properties worth stating explicitly rather than leaving implicit:

- **Naturally idempotent, by construction, not by any added locking.** `expireStaleBookings()`'s query is `WHERE status: PENDING_PROVIDER AND availability.startTime <= now`. A booking already transitioned to `EXPIRED` by a previous run simply no longer matches that clause — so if Vercel Cron ever double-fires (or an operator manually re-triggers it), the second run finds a strict subset of what the first found and does no harm. No dedupe/locking mechanism was added because none is needed.
- **No retry on a missed invocation.** Vercel Cron does not retry a failed/missed tick on its own. A missed run just means any newly-stale bookings expire up to 30 minutes later, at the next scheduled tick — an acceptable, self-healing degradation given the job's own idempotency above, not a data-loss risk. If this job's cadence ever needs a stricter bound (e.g. expiry within 1 minute of the slot passing, not 30), that is a scheduling-frequency change (`vercel.json`), not a resilience gap to engineer around.

Backup/restore strategy and RPO/RTO targets remain genuinely open decisions at the infrastructure/vendor level — see `DEPLOYMENT_AND_INFRASTRUCTURE.md` §9 and §15's Open Decisions list. Nothing in this phase resolves those; they are outside this repository's code.

## 9. Known Gaps (Do Not Assume Otherwise)

Carried over honestly from the Phase D.2 audit, unresolved by this document:

- No error-tracking/APM service integrated (Sentry is the named intended tool in `TECH_STACK.md` §13; not yet wired in). Phase 5.2 added structured request-correlation IDs and per-request duration logging (`src/lib/observability/`) as a foundation a real APM integration could build on, but nothing external is actually wired up.
- No automated database backup or tested restore procedure exists yet — `DEPLOYMENT_AND_INFRASTRUCTURE.md` §9 documents the *intended* philosophy, not a working implementation.
- No sitemap.xml exists — services are dynamic (Providers publish/archive them continuously), so a static sitemap would go stale immediately; a real one requires either a scheduled job or a dynamic, database-backed sitemap route, neither of which this phase builds. `robots.txt` (`src/app/robots.ts`) intentionally does not reference a sitemap that doesn't exist.
- No CSP nonce infrastructure — the production CSP (`next.config.ts`) uses `'unsafe-inline'` for script/style rather than per-request nonces, a deliberate, documented trade-off (see that file's own comment) given this phase's "safe, non-breaking" mandate.
- HSTS `preload` submission to browser vendors' preload list is a manual, external, one-time step — not done as part of this phase.
- No admin UI exists to browse the new `AuditLog`/`BookingStatusEvent` tables — direct database/Prisma Studio access is the only way to read them today.
- Two `NODE_ENV`-gated test-only routes (`/api/test/admin`, `/api/test/protected`) still ship in the production bundle, returning 404 at runtime rather than being excluded from the build entirely — low severity, not resolved this phase.
- Blanket automated test coverage for every provider/booking server action remains incomplete — each phase has added tests only for the files it actually modified. The Production Hardening phase added focused coverage for `create-booking.ts`'s new rate-limit branch plus its happy path (not an exhaustive audit of every existing branch — the slot-capacity race and duplicate-booking guard remain untested). `accept-booking.ts`, `cancel-booking.ts`, `complete-booking.ts`, `start-booking.ts`, `reject-booking.ts`, and every `get-provider-*` query module remain untested.
