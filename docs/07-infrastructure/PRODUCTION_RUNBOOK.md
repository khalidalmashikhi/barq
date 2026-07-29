# BARQ Production Runbook

- **Purpose:** The single operational sequence a human runs to deploy, verify, restart, or roll back BARQ in production — every step is verified against the actual repository state (real scripts, real endpoints, real doc cross-references), not aspirational. Complements `PRODUCTION_READINESS.md` (the pre-deploy readiness checklist covering *what must be true before you start*) — this document covers *what you actually do*, in order, including after something goes wrong.
- **Scope:** Deployment steps, migration execution, health verification, smoke testing (pointer), rollback, rollback verification, recovery checklist, startup/restart procedures, maintenance windows, emergency-contact placeholders, known limitations.
- **Out of Scope:** Hosting-provider-specific console instructions (this project doesn't fix a specific host beyond ADR-0007's Vercel default), infrastructure-as-code, monitoring-vendor setup.
- **Status:** Added — Go-Live Preparation phase.
- **Owner:** Whoever operates a production deploy. Keep current as real deployment experience accumulates.

---

## 1. Deployment Steps

Run in order. This sequence assumes a Vercel-style Git-triggered deploy (ADR-0007) but every step is stated generically enough to run manually against any Node 20+ host.

1. **Confirm the target environment's variables are complete** — see `ENVIRONMENT_AUDIT.md` for the full classified list. Run `NODE_ENV=production npm run validate-env` against the real target environment's variables (not `.env` locally) before deploying.
2. **Confirm OTP delivery is genuinely configured** — `OTP_PROVIDER` must resolve to a real provider (not `console`); `scripts/validate-env.ts` already fails the build/start otherwise, but confirm the actual Twilio credentials are the *real* production ones, not a copied dev/staging value.
3. **Confirm the payment provider boundary is what you intend** — `PAYMENT_PROVIDER=NONE` (the default) keeps every payment call resolving to the safe no-op provider. Activating `STRIPE` is explicitly out of scope for every phase through this one — do not flip this without a separately approved payment-activation phase.
4. **Run database migrations before new code serves traffic**: `npx prisma migrate deploy` (never `migrate dev` against production — see §2). On Vercel, the project's **Build Command** should be `npm run vercel-build`, which runs `prisma migrate deploy && next build` automatically on every deploy — confirm this is actually the configured build command, not assumed.
5. **Build**: `npm run build` with `NODE_ENV=production` and the real target environment's variables.
6. **Quality gates**: `npm run typecheck`, `npm run lint`, `npm run test` — the same three gates `.github/workflows/ci.yml` already enforces on every PR to `main`. A production deploy should never ship code that hasn't passed these against the real branch being deployed.
7. **Deploy** via the host's normal mechanism (Vercel Git integration, or an equivalent CI/CD trigger elsewhere).
8. **Verify health** — see §4 below — before considering the deploy live.
9. **Run the smoke-test sequence** — see `SMOKE_TEST_GUIDE.md` — against the real deployed instance, not a cached CDN response.
10. **Confirm security posture** — see `PRODUCTION_SECURITY_CHECKLIST.md`.

## 2. Migration Execution

- **Always** `npx prisma migrate deploy` in production — applies pending migrations non-interactively and fails loudly on drift. **Never** `npx prisma migrate dev` against production — it can prompt interactively and is designed for local development only.
- Run migrations **before** the new application code starts serving traffic (step 4 above) — `vercel-build`'s own `prisma migrate deploy && next build` ordering already enforces this on Vercel; elsewhere, run it as an explicit prior step.
- Before running, check `npx prisma migrate status` against the target database — confirm it reports a clean, expected state (no unexpected drift) before applying anything new.
- **Correction (Code Freeze / Operational Validation phase — this claim was previously wrong and must not be relied upon):** not every migration in this repository is additive. A direct re-audit of every file in `prisma/migrations/` found four migrations that are not purely additive — three from `2026-07-07` (`fix_better_auth_id_format`, `separate_better_auth_user`, `align_better_auth_user_field_names`) contain genuine `DROP COLUMN`/primary-key-type changes with Prisma's own generated "all the data in the column will be lost" warnings, and one from `2026-07-10` (`availability_capacity_model`) rewrites existing `AvailabilitySlotState` enum values (`BOOKED` → `OPEN`) as part of a hand-authored, not machine-verified migration. See `docs/11-release/CODE_FREEZE_CHECKLIST.md` §2 for the full, migration-by-migration audit table. These four migrations already shipped and already ran against every environment that has been migrated since — they are not a future risk to prevent, they are historical fact to know about. They pose **no realistic risk to a first production deployment against a brand-new, empty database** (every affected column/table has zero rows at that point), but they mean the blanket claim "no destructive migration has ever shipped" is false and must never be used to justify skipping a migration-safety review for any *future* migration once production has real data. Every migration from `2026-07-20` onward (16 of 19 total) is confirmed purely additive.

## 3. Recommended Repository-Owned Verification (see §9 for the script)

Before and after a deploy, `scripts/verify-deployment.ts` (added this phase) can be pointed at any URL to sanity-check the deployed instance's health endpoint, `robots.txt`, and `sitemap.xml` in one command — see §9.

## 4. Health Verification

`GET /api/health` — expect `200` with:
```json
{"status":"ok","database":"ok","otpProvider":"<console|twilio>","paymentProvider":"<NONE|STRIPE>","environment":"ok","version":"...","timestamp":"..."}
```
- `503` means at least one of `database`/`otpProvider`/`paymentProvider`/`environment` failed — the response body says which.
- `"otpProvider":"console"` in a real production response is itself a red flag worth investigating even though the endpoint still reports `200`/`ok` for that field's own narrow meaning — cross-check against §1 step 2's actual intent for this deploy.
- Do not add this instance to a load balancer's healthy pool, or consider a deploy complete, until this returns `200`.

## 5. Smoke Testing

Full manual sequence: `SMOKE_TEST_GUIDE.md`. Run the Customer, Provider, and Admin sequences against the real deployed instance after every production deploy, not only the first one.

## 6. Rollback

1. **Application rollback**: redeploy the immediately-prior known-good build via the hosting platform's own "redeploy previous version" mechanism. This project has no custom rollback tooling of its own.
2. **Database migration rollback**: Prisma does not auto-generate a `down` migration. If the deploy being rolled back included a schema migration:
   - Check `prisma/migrations/` for exactly what changed.
   - If purely additive (the pattern every migration has followed to date — §2), the prior application version simply ignores the new column/table/index; rollback is safe with no reverse migration needed.
   - If not purely additive, a hand-written reverse migration is required *before* redeploying the prior application code.
3. **Never** roll back by deleting or manually editing rows to "undo" a mutation that already committed — that bypasses the audit trail (§8) and can leave the database in a state no migration history explains.

## 7. Rollback Verification

1. `GET /api/health` returns `200` again.
2. Re-run the relevant portion of `SMOKE_TEST_GUIDE.md`'s Customer sequence (at minimum: login, browse, one booking flow) against the rolled-back instance.
3. Confirm `npx prisma migrate status` reports a clean, expected state matching the rolled-back application version's own expectations.
4. Record what happened (§8).

## 8. Recovery Checklist

1. **Detect** — via `/api/health` monitoring (if configured externally — see `PRODUCTION_READINESS.md` §9's "no monitoring vendor wired in yet" gap) or a direct user/support report.
2. **Contain** — Better Auth session revocation is available if a specific account/session needs immediate invalidation; no broader "kill switch" exists in this codebase today.
3. **Investigate** — using the real evidence this codebase already writes: `AuditLog` (admin/provider mutations), `BookingStatusEvent` (every booking status change), structured request-correlation logs (`src/lib/logger.ts` + `src/lib/observability/`). Neither `AuditLog` nor `BookingStatusEvent` has an admin UI reader yet — direct database/Prisma Studio access is the only way to read them today (a known, pre-existing gap, not resolved by this phase).
4. **Recover** — apply §6's rollback procedure if the incident is code/deploy-related; there is no automated backup/restore procedure for data-level incidents (see §11's Known Limitations — this remains a genuinely open infrastructure gap, not solved by this phase).
5. **Record** — write the incident narrative down somewhere durable (even a plain doc) using the audit trail as supporting evidence. Neither `AuditLog` nor `BookingStatusEvent` is itself an incident-tracking system (no severity levels, no resolution workflow).

## 9. Startup Procedure

1. Ensure target environment variables are complete (`ENVIRONMENT_AUDIT.md`).
2. `npm ci` (not `npm install`) for a reproducible install matching `package-lock.json` exactly.
3. `npx prisma migrate deploy` (or rely on `vercel-build`'s own ordering).
4. `npm run build` then `npm start` (or the host's equivalent).
5. Confirm `GET /api/health` returns `200` before routing real traffic.

## 10. Restart Procedure

A restart (no code/schema change, e.g. after a transient crash or a manual process recycle) does **not** need migrations re-run — `prisma migrate deploy` is idempotent, but re-running it on every restart is unnecessary overhead, not a requirement. Sequence:
1. Stop the running process/instance via the host's own mechanism.
2. Start it again — the same `npm start` (or host equivalent) that startup used.
3. Confirm `GET /api/health` returns `200` before the instance rejoins traffic.
4. If the restart followed a crash, check recent structured logs (`src/lib/logger.ts` output) for the `*.request_failed` line that preceded it, per `src/lib/observability/with-request-tracing.ts`'s own logging shape.

## 11. Maintenance Window

BARQ has no built-in maintenance-mode toggle (no feature flag or middleware gate that returns a maintenance page platform-wide) — a maintenance window today means either:
- Scheduling the deploy/migration for a real low-traffic period (this is an Oman-based marketplace — late-night Gulf Standard Time is the natural low-traffic window), or
- Relying on the hosting platform's own maintenance-page mechanism if it has one (host-specific, out of this document's scope).

A dedicated maintenance-mode feature is a legitimate future improvement — not built this phase (would be new application behavior, outside "documentation, automation, and operational readiness" scope).

## 12. Emergency Contacts

**Placeholder — fill in with real names/channels before relying on this document during an actual incident. No fabricated names are used here, deliberately, per this phase's explicit instruction.**

| Role | Contact |
|---|---|
| Primary on-call engineer | _(fill in)_ |
| Secondary on-call engineer | _(fill in)_ |
| Database/infrastructure owner | _(fill in)_ |
| Product/business escalation | _(fill in)_ |
| Hosting platform support channel | _(fill in — e.g. Vercel support plan tier)_ |
| OTP provider (Twilio) support channel | _(fill in)_ |

## 13. Known Limitations (honest, as of this phase)

- **No automated database backup or tested restore procedure** — `DEPLOYMENT_AND_INFRASTRUCTURE.md` §9 documents the intended philosophy, not a working implementation. This is the single largest gap between "documented runbook" and "genuinely disaster-proof operation."
- **No external monitoring/alerting/APM is wired in** — `/api/health` exists and is accurate, but nothing currently polls it automatically or pages anyone. Wiring an external monitor to this endpoint is the single highest-leverage, lowest-effort operational improvement available post-launch (no code change required — pointing an existing/future monitoring service at this endpoint is a config-only action for that separate phase).
- **Rate limiting is in-memory, per-instance** — see `PRODUCTION_READINESS.md` §7. Not a global/durable limit.
- **No maintenance-mode toggle** exists (§11).
- **The legacy i18n gap** (~1,092+ untranslated placeholder strings in `cs/de/fr/it/pl/ru`) remains a known, previously-deferred product decision — see `docs/project-memory/13-OPEN-QUESTIONS.md`.
- **`AuditLog`/`BookingStatusEvent` have no admin UI reader** — direct database access is the only way to read them today.

---

## Related Documents
- `PRODUCTION_READINESS.md` — pre-deploy readiness checklist and environment/secrets detail
- `ENVIRONMENT_AUDIT.md` — full classified environment-variable inventory
- `docs/11-release/RELEASE_CHECKLIST.md` — the Go-Live release checklist (a companion to this runbook, checkbox-shaped rather than procedural)
- `SMOKE_TEST_GUIDE.md` — the full manual smoke-test sequence referenced in §5
- `PRODUCTION_SECURITY_CHECKLIST.md` — the security-specific pre-launch checklist referenced in §1 step 10
- `OTP_PRODUCTION.md` §6 — the OTP-specific deployment sequence detail this runbook's §1 step 2 summarizes
- `DEPLOYMENT_AND_INFRASTRUCTURE.md` — the architectural principles this runbook operationalizes
