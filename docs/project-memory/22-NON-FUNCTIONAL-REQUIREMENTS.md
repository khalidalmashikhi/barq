# 22 — Non-Functional Requirements (Enterprise Governance Layer)

Current state and target for each NFR category, heavily cross-referencing the existing Locked/phase-report documents that already cover most of this ground in more depth — this file is the single-page index, not a replacement for any of them.

## Performance

**Current:** No formal performance budget or SLO exists. Real, verified optimizations: atomic capacity-guard SQL for booking concurrency (BR-010), two added `Booking` indexes (`serviceId`, composite `providerId+status` — Phase 5.2), the Customer Dashboard's parallelized queries. Known, documented, deliberately-deferred candidate: the Provider Dashboard's ~15-16 query page (`docs/07-infrastructure/PRODUCTION_READINESS.md` §8's sibling reasoning — not implemented, no measured slowdown yet to justify it).
**Target:** A real performance budget once traffic patterns exist to measure against — not invented speculatively (YAGNI, `docs/00-foundation/PROJECT_RULES.md`).

## Availability

**Current:** Single Vercel deployment, no documented uptime SLA. `/api/health` (real, Phase D.3/5.2) gives a genuine `SELECT 1` connectivity check — see `docs/07-infrastructure/PRODUCTION_READINESS.md` §5 for startup verification steps that depend on it.
**Target:** Formal SLA — not committed anywhere yet; `docs/07-infrastructure/DEPLOYMENT_AND_INFRASTRUCTURE.md` §9/§15 leaves RPO/RTO as explicit Open Decisions.

## Scalability

**Current:** Modular Monolith (ADR-0002) — single deployable, scales vertically/via Vercel's own platform scaling. No sharding, no read-replica strategy, no queue-based async processing anywhere.
**Target:** `docs/02-domain-architecture/TECH_STACK.md` names Redis as "Approved" for caching (not yet implemented — see Caching below) and GCC multi-country expansion as a driver for eventual ABAC (`docs/03-platform-capabilities/IDENTITY_AND_ACCESS.md` §13) — both explicitly directional, not committed for V1.

## Security

**Current:** Fully covered by `docs/05-trust-and-compliance/SECURITY.md` (Locked) and this project-memory's own `11-SECURITY-POLICY.md` — not duplicated here. Concretely real today: production-only CSP + HSTS + standard security headers (`next.config.ts`), `trustedOrigins` + explicit session duration on Better Auth (Phase 5.2), RBAC via `src/lib/auth/rbac.ts`, atomic audit logging (BR-019), OTP rate limiting (see Rate Limiting below).
**Known gap:** No CSP nonce infrastructure (`'unsafe-inline'` remains, a documented trade-off — `docs/07-infrastructure/PRODUCTION_READINESS.md` §9/known gaps).

## Localization

**Current:** Fully covered by ADR-0005, ADR-0010, and `09-TRANSLATION-I18N.md` — not duplicated here. 8 locales, bilingual-by-design, Arabic RTL as first-class.

## Accessibility

**Current:** Fully covered by `docs/04-experience/ACCESSIBILITY.md` (Locked). Verified in practice across multiple phases (Phase F.1–F.5's own accessibility audits) — not re-derived here.
**Target:** No new accessibility commitment introduced by this documentation phase; every future engine's UI must meet the same existing bar, not a lesser one.

## Logging

**Current:** Real, structured JSON-line logging (`src/lib/logger.ts`, Phase D.3) with automatic request-correlation-ID attachment for Route Handlers (`src/lib/observability/`, Phase 5.2). No third-party log aggregation service — whatever the hosting platform's own log viewer captures is the only log storage today.
**Target:** None specifically new — the existing logger/observability foundation is designed to extend to future engines without redesign (every engine's mutations should call `logger.error`/`logger.info` with the same structured shape, and any new Route Handler should use `withRequestTracing`).

## Monitoring

**Current:** `/api/health` endpoint only. **No error-tracking/APM service is wired up** — Sentry is named "Approved" in `docs/02-domain-architecture/TECH_STACK.md` §13 but is absent from `package.json`/`.env.example` (verified, real gap, carried forward honestly across every phase report that's touched this since Phase D.3). OpenTelemetry is explicitly "Future," not committed for V1 (`TECH_STACK.md` §13).
**Target:** Real Sentry (or equivalent) integration — blocked on an actual account/DSN existing, not a code-readiness problem; the correlation-ID/structured-logging foundation (Phase 5.2) is designed to make wiring one in straightforward whenever it happens.

## Backups

**Current:** **No automated database backup or tested restore procedure exists** — `docs/07-infrastructure/DEPLOYMENT_AND_INFRASTRUCTURE.md` §9 documents the *intended* philosophy only, not a working implementation (carried forward honestly since Phase D.3/5.2's own reports).
**Target:** Whatever the managed PostgreSQL provider's own backup tooling offers, formally verified with an actual restore drill — cadence is an explicit Open Decision (`DEPLOYMENT_AND_INFRASTRUCTURE.md` §15).

## Disaster Recovery

**Current:** RPO/RTO targets are explicit, named Open Decisions in `DEPLOYMENT_AND_INFRASTRUCTURE.md` §9/§15 — not numerically defined anywhere.
**Target:** Real numeric targets, once decided — not invented by this documentation phase.

## Testing

**Current:** Vitest (unit) + Playwright (e2e, installed but zero spec files as of the last verified check) — see `docs/00-foundation/ENGINEERING_GUIDE.md` §7 for the philosophy. 461 real tests exist as of Phase 5.2's final verification, covering booking/contract lifecycle, OTP, i18n helpers, and the mutation sites Phase 5.2 itself touched. **Coverage is uneven** — many provider/booking action files remain untested (documented honestly in Phase 5.2's own report as a "remaining production risk," not hidden).
**Target:** No formal coverage threshold exists or is proposed here — `docs/00-foundation/PROJECT_RULES.md`'s own testing minimums govern what's required going forward; each future engine's implementation phase sets its own testing strategy per the established `inspect → plan → implement → test → verify` discipline.

## Code Quality

**Current:** `tsconfig.json` strict mode + `noUncheckedIndexedAccess`; ESLint (`eslint-config-next`) enforced in CI (`.github/workflows/ci.yml`); `docs/00-foundation/ENGINEERING_GUIDE.md` §6's Code Review checklist (Architecture/Security/Performance/Accessibility/Localization/AI sub-passes). English-only code identifiers (`PROJECT_RULES.md` §23).
**Target:** No new commitment introduced here.

## API Versioning

**Current gap, verified and already flagged (BR-018, `13-OPEN-QUESTIONS.md`):** ADR-0011 mandates versioned public APIs (`/api/v1/...`); the real API surface (`src/app/api/`) has zero versioning today. This NFR document does not resolve the gap — it restates it here because "API Versioning" is an explicit NFR category this phase asked to document, and the honest answer is that it's a known, outstanding non-conformance with a Locked ADR.
**Target:** Close the gap when the first new engine's API is actually built — ideally applying versioning going forward rather than a disruptive retrofit of existing, working endpoints (an open sequencing question, not decided here).

## Rate Limiting

**Current:** **Narrow, not general.** The only rate limiting anywhere in the codebase is OTP-specific: a per-phone-number resend cooldown (`check-resend-cooldown.ts`) and a daily send-limit cap (`check-daily-send-limit.ts`, Phase 5.1). **No general API rate limiting exists** — no per-IP, per-user, or per-endpoint throttling on any Route Handler or Server Action beyond the OTP flow.
**Target:** A general rate-limiting layer would need Redis (or equivalent) — currently "Approved" but unimplemented (see Caching below) — as its natural backing store; not scoped further here.

## File Storage

**Current:** **No working file-upload path exists at all.** ADR-0006 mandates "DB stores metadata only, files live in Object Storage," but no Object Storage vendor has been selected (`TECH_STACK.md` §23 Open Decision), and no generic `Attachment`/`Document` metadata model exists either (`15-DATA-DICTIONARY.md`). This blocks several target features directly: Provider logo/gallery, Service gallery, commercial-provider Documents.
**Target:** Vendor selection is a `TECH_STACK.md`-level decision, not this document's to make — flagged as a genuine blocker for Provider Engine/Service Engine's target scope (`21-ENGINE-SPECIFICATIONS.md`).

## Search

**Current:** `get-services.ts`'s existing filter/pagination is a direct Prisma query against PostgreSQL — no dedicated search engine (Elasticsearch, Algolia, Postgres full-text search extensions, etc.) is used anywhere. Sufficient for current data volume; explicitly not a proven bottleneck.
**Target:** A real search engine only if/when category browsing (Category Engine) and data volume growth make plain Prisma queries insufficient — not built ahead of that need.

## Caching

**Current:** **No caching layer exists anywhere in the application.** Redis is marked "Approved" in `TECH_STACK.md` §6 but is absent from `package.json`, `.env.example`, and every piece of code in `src/` — a real, verified docs-vs-code gap, not an oversight to silently fix here.
**Target:** Wiring in Redis would unlock rate limiting (above) and reduce database load for read-heavy paths (Category tree, published Service listings) — not scoped further; a genuine future decision, not invented by this phase.

---

## Summary table

| NFR | Status |
|---|---|
| Performance | No formal budget; real targeted optimizations exist |
| Availability | No SLA; real health check exists |
| Scalability | Modular monolith; no sharding/queue/cache |
| Security | Strong, well-documented; one known CSP-nonce gap |
| Localization | Strong, mature, 8 locales |
| Accessibility | Strong, audited across multiple phases |
| Logging | Real, structured, correlation-ID-enabled |
| Monitoring | Health check only; **no APM/error-tracking wired up** |
| Backups | **Not implemented, not tested** |
| Disaster Recovery | **RPO/RTO undefined** |
| Testing | Real but uneven coverage; no Playwright specs yet |
| Code Quality | Strong — strict TS, enforced lint, code review checklist |
| API Versioning | **Known gap vs. ADR-0011** |
| Rate Limiting | **OTP-only, no general API rate limiting** |
| File Storage | **Does not exist — no vendor selected, no metadata model** |
| Search | Plain Prisma queries; sufficient at current scale |
| Caching | **Does not exist — Redis approved but unimplemented** |

Six of seventeen categories carry a **verified, real gap** (bolded above) rather than "strong" or "documented but pending a future decision" status — these are the honest priority list for anyone assessing production/enterprise readiness beyond feature completeness.
