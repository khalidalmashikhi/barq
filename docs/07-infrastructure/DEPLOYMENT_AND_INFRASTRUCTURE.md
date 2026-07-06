# BARQ Deployment and Infrastructure

- **Purpose:** Define BARQ's deployment architecture and operational infrastructure — environments, deployment strategy, operational topology, scalability philosophy, observability integration, disaster recovery, and operational governance. This document does not define vendor configuration, Terraform, Docker, Kubernetes manifests, cloud scripts, implementation, or code.
- **Scope:** Infrastructure principles, deployment environments, deployment strategy, application topology, infrastructure components, scaling strategy, availability, disaster recovery, monitoring, secrets management, cost governance, and future infrastructure evolution.
- **Out of Scope:** Vendor configuration, Terraform, Docker configuration, Kubernetes manifests, cloud scripts, implementation, code.
- **Dependencies:** `PROJECT_MANIFEST.md`, `SYSTEM_ARCHITECTURE.md` §11, §13–§14 (scalability, failure, and deployment-view reasoning this document operationalizes), `TECH_STACK.md` §14–§15 (CI/CD and Hosting — referenced, not redefined), `SECURITY.md` §8–§11 (operational/infrastructure security, elaborated here from the deployment side), `DATABASE_DESIGN.md` §14 (Backup & Disaster Recovery — this document resolves that section's deferred Recovery Objectives), `ADR-0002-modular-monolith.md`, `ADR-0007-frontend-backend-hosting-stack.md`.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## A Note on What This Document Closes

`DATABASE_DESIGN.md` §14 explicitly deferred Recovery Strategy and Recovery Objectives to "future `DEPLOYMENT_AND_INFRASTRUCTURE.md`." `SYSTEM_ARCHITECTURE.md` §14's Deployment View and §11's Scalability Strategy anticipated this document elaborating them operationally. `SECURITY.md` §8–§9 referenced this document for Backup/Recovery's security treatment and Hosting's shared-responsibility detail. This document fulfills those forward references — §9 resolves `DATABASE_DESIGN.md` §14's Recovery Objectives specifically, flagged explicitly where it does.

---

## 1. Executive Summary

BARQ's infrastructure exists to run the Modular Monolith (`ADR-0002`) reliably, securely, and cheaply at its current stage — Salalah launch scale — without foreclosing the GCC-expansion and module-extraction paths `SYSTEM_ARCHITECTURE.md` §11 already designed for. Per `PROJECT_MANIFEST.md`'s Engineering Philosophy and `ARCHITECTURE_PRINCIPLES.md` Principle 26 (Cost-Aware Architecture), BARQ favors managed services over self-managed infrastructure at every point where the cost/control trade-off favors managed — consistent with `TECH_STACK.md`'s Vercel/PostgreSQL/Redis choices. `SECURITY.md`'s trust boundaries and operational security requirements are the constraints this document's environments and deployment pipeline are built to satisfy, not an afterthought layered on top of infrastructure already decided. This document is deliberately unglamorous by design: the goal is an infrastructure that is boring, predictable, and cheap until real scale demands otherwise — excitement in infrastructure is usually a symptom of avoidable risk, not a sign of good engineering.

## 2. Infrastructure Principles

- **Cloud First:** BARQ runs on managed cloud infrastructure from day one — no self-hosted physical infrastructure at any stage of this project's foreseeable roadmap.
- **Managed Services First:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 26 — a managed service (hosting, database, cache, object storage) is preferred over a self-managed equivalent wherever the operational burden reduction is worth the reduced control, which at BARQ's current stage is nearly always.
- **Security by Design:** Per `SECURITY.md` §2 — infrastructure decisions are evaluated against that document's trust boundaries (§3) before being adopted, not audited for security after the fact.
- **Scalability by Design:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 21 and `SYSTEM_ARCHITECTURE.md` §11 — infrastructure choices don't preclude horizontal scaling, module extraction, or multi-region deployment later, even though none of those are active at V1.
- **Cost-Aware Architecture:** Per Principle 26 — restated here as the dominant lens for every infrastructure decision in this document, exactly as it was for `TECH_STACK.md`.
- **Observability by Default:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 20 — every environment from Development onward has monitoring/logging enabled by default (§10), never bolted on only in Production.
- **Automation First:** Deployment, testing gates, and routine operational tasks are automated (§4) — manual production operations are the exception requiring justification, not the default mode of operation.
- **Reliability First:** Per Principle 22 (Fail Gracefully) — availability (§8) and disaster recovery (§9) are designed in, not treated as insurance purchased only after an incident.

## 3. Deployment Environments

- **Local Development:** Each developer's own isolated environment, mirroring the Modular Monolith's module structure (`SYSTEM_ARCHITECTURE.md` §14) — no shared state with any other environment.
- **Development:** A shared, low-stakes environment for integrating in-progress work — data here is disposable and never Confidential/Restricted-classified real data (`SECURITY.md` §5).
- **Testing:** An environment specifically for automated test execution (`TECH_STACK.md` §17's Vitest/Playwright), isolated from Development so flaky or resource-intensive test runs don't disrupt ongoing integration work.
- **Staging:** A production-like environment for pre-release validation — same configuration pattern as Production (§6), differing only in data and real-world traffic, per `SYSTEM_ARCHITECTURE.md` §14.
- **Production:** The live Salalah-launch environment (`PRODUCT_REQUIREMENTS.md` §5) — the only environment serving real Customers, Providers, and Staff.
- **Purpose:** Each environment exists to answer a different question — Local ("does my change work at all"), Development ("does it integrate"), Testing ("do the automated suites pass"), Staging ("does it behave like Production will"), Production ("does it serve real users correctly") — never blurred into serving more than one of these purposes at once.
- **Isolation:** No environment shares a database, secret, or credential with another (`SECURITY.md` §3, §8) — a Staging compromise, for example, must never expose a Production secret.
- **Promotion Flow:** Code moves Local → Development → Testing → Staging → Production in that order, gated by the Quality Gates already established in `TECH_STACK.md` §14 — no environment is skipped for a routine change, and any exception (a genuine hotfix) is itself an Open Decision on process (§15), not an ad hoc judgment call made silently each time.

## 4. Deployment Strategy

- **CI/CD Philosophy:** Per `TECH_STACK.md` §14 — GitHub Actions enforces the branch/review discipline in `PROJECT_RULES.md` §11–§14 automatically; this document adds that CI/CD is the *only* path to Production (§14's anti-pattern against manual deployment).
- **Incremental Releases:** Small, frequent releases are preferred over large, infrequent ones — consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 17 (Simplicity over Cleverness) applied to release size: a smaller release is easier to reason about, test, and roll back than a large one.
- **Rollback Strategy:** Every release has a defined path back to the previous known-good state — consistent with Vercel's native Git-integrated deployment model (`ADR-0007`), which supports rolling back to a prior deployment directly; this document states the requirement, not the vendor-specific mechanism (Out of Scope).
- **Blue/Green Readiness:** Not a committed V1 mechanism, but the stateless-service design (§7) and Vercel's deployment model keep this option realistic to adopt later without an architecture change, consistent with Cost-Aware Architecture (adopt when needed, not speculatively).
- **Feature Flags Philosophy:** Per `SYSTEM_ARCHITECTURE.md` §6 — used for staged rollout of new capability, never as the mechanism by which an incomplete bilingual feature ships "in one language for now" (`ADR-0005`) — restated here because deployment strategy is exactly where that discipline could otherwise quietly erode under release-schedule pressure.

## 5. Application Topology

- **Frontend:** Next.js (`TECH_STACK.md` §3), served from the same deployable as the Backend, per the Modular Monolith (`ADR-0002`).
- **Backend:** Next.js Route Handlers/Server Actions on Node.js LTS (`TECH_STACK.md` §4).
- **API Layer:** The contract boundary defined in `API_CONTRACTS.md` — logically distinct from the Backend's internal structure even though both are deployed together.
- **Database:** PostgreSQL via Prisma (`ADR-0006`), accessed only through module-scoped credentials (`SECURITY.md` §9).
- **Storage:** S3-compatible Object Storage (`TECH_STACK.md` §7), metadata-only in PostgreSQL (`ADR-0006`).
- **AI Gateway:** The LLM Gateway abstraction (`TECH_STACK.md` §11) sitting between the AI Layer (`SYSTEM_ARCHITECTURE.md` §4) and candidate providers (OpenAI, Anthropic) — deployed and scaled independently where its resource profile (model inference) genuinely diverges from the rest of the platform's request/response profile (`SYSTEM_ARCHITECTURE.md` §5's AI module note).
- **External Services:** Maps, WhatsApp, Payment Gateway — all behind the Integration Layer (`SYSTEM_ARCHITECTURE.md` §4), never called directly from Domain Layer code.
- **Trust Boundaries:** Fully governed by `SECURITY.md` §3 — referenced, not restated; this document's topology is the physical/deployment expression of those same boundaries, not a competing model of them.

## 6. Infrastructure Components

- **Hosting:** Vercel (`ADR-0007`) — referenced, not redefined.
- **Database:** PostgreSQL, managed (not self-hosted) — consistent with Managed Services First (§2); specific managed-provider selection is vendor configuration, Out of Scope.
- **Object Storage:** S3-compatible (`TECH_STACK.md` §7) — specific provider not yet selected (`TECH_STACK.md` §23).
- **Caching:** Redis (`TECH_STACK.md` §8), managed.
- **Queue (Future):** Not part of V1 — a candidate Redis-backed or dedicated queueing mechanism for Background Jobs (`SYSTEM_ARCHITECTURE.md` §7) once volume justifies it beyond what synchronous processing or simple async patterns can handle.
- **Search (Future):** Not part of V1 — BARQ's V1 search needs (`LOCALIZATION.md` §9) are served by database-level query capability; a dedicated search infrastructure component is a future consideration only if that stops being sufficient.
- **CDN:** For static assets and cached imagery (`SYSTEM_ARCHITECTURE.md` §10), typically included natively with the chosen Hosting platform rather than a separately managed component.

## 7. Scaling Strategy

- **Horizontal Scaling:** The first scaling lever, per `SYSTEM_ARCHITECTURE.md` §11 — multiple stateless application instances behind the Hosting platform's own load distribution, exhausted before reaching for anything more complex.
- **Vertical Scaling:** Applied to the Database specifically, where a managed provider's tiering typically makes vertical scaling the simpler first step before read replicas or partitioning become necessary.
- **Stateless Services:** The application layer holds no in-process session state that would prevent running multiple instances (`SYSTEM_ARCHITECTURE.md` §11) — session state lives in the Database/Cache layer, not in any single running instance's memory.
- **Database Scaling:** Vertical scaling first, then read replicas for read-heavy paths (e.g. Operations Center's real-time views, `SYSTEM_ARCHITECTURE.md` §5), then partitioning/sharding only if genuinely justified by real load — each step adopted only when the previous one is demonstrably insufficient, never pre-emptively.
- **Future Multi-Region:** Per `SYSTEM_ARCHITECTURE.md` §14 and `DATABASE_DESIGN.md` §8 — not a V1 commitment; the Tenant concept (`GLOSSARY.md` term 10) and current Hosting/Database choices are selected partly because they don't preclude this later.

## 8. Availability

- **Health Checks:** Every deployed instance exposes a basic health signal used by the Hosting platform to route traffic only to healthy instances — mechanics are implementation detail, the requirement that this exists is stated here.
- **Readiness:** A distinct signal from basic health — an instance is "ready" only once it can actually serve traffic correctly (e.g. database connectivity established), not merely "running."
- **Liveness:** A signal distinguishing "this instance is still functioning" from "this instance is ready for traffic" — an instance can be alive but not yet ready, and the platform must not conflate the two.
- **Graceful Degradation:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 22 and `SYSTEM_ARCHITECTURE.md` §13 — restated at the infrastructure level: a dependency outage (Database, Cache, a third-party Integration) degrades the affected feature, never the entire platform, wherever architecturally possible.
- **Maintenance Mode:** A defined, communicated state for planned maintenance — Customers/Providers see a clear, honest message (consistent with `DESIGN_SYSTEM.md` §18's Empty States philosophy) rather than an unexplained failure.

## 9. Disaster Recovery

**Resolving `DATABASE_DESIGN.md` §14's deferred Recovery Strategy and Recovery Objectives:**

- **Backup Philosophy:** Per `DATABASE_DESIGN.md` §14 and `SECURITY.md` §8 — regular, automated, encrypted backups covering all persistent data, with particular attention to financial (`Wallet Transaction`, `Payment`, `Invoice`) and identity (`User`) data given their compliance sensitivity and Restricted/Confidential classification (`SECURITY.md` §5).
- **Recovery Objectives — resolved here:** BARQ targets a Recovery Point Objective (RPO) and Recovery Time Objective (RTO) appropriate to a single-market, early-stage platform rather than a zero-tolerance financial institution's standard — specific numeric targets are an Open Decision (§15), not invented here, but the requirement that both RPO and RTO are explicitly defined (rather than left implicit) is resolved now: this document is where they will be stated once operational experience or a compliance requirement (`SECURITY.md` §13) makes a specific number meaningful rather than arbitrary.
- **Restore Validation:** A backup is only as good as its tested restore path — periodic restore drills (cadence an Open Decision, §15) validate that backups are actually usable, not merely present.
- **Business Continuity:** In the event of an extended outage, the priority order for restoring service is: Authentication/Booking (the platform's core transactional path) first, then Wallet/Payments (financial integrity), then secondary features (Reviews, Reports) last — stated here as a principle, with the exact operational runbook itself an implementation detail.

## 10. Monitoring

- **Metrics:** Per `TECH_STACK.md` §13 (Sentry) — per-environment, per-service latency, error rate, and volume, satisfying `ARCHITECTURE_PRINCIPLES.md` Principle 20.
- **Logs:** Per `DATABASE_DESIGN.md` §9's Activity/Audit Log separation and `SECURITY.md` §9–§10 — structured, correlated, and never containing unmasked Confidential/Restricted data.
- **Tracing:** Per `API_CONTRACTS.md` §16 — Trace IDs spanning cross-module calls; Future OpenTelemetry (`TECH_STACK.md` §13) if distributed tracing needs grow beyond Sentry's APM alone.
- **Alerts:** Per `SECURITY.md` §10 — defined thresholds trigger human notification; specific thresholds remain an Open Decision shared with that document (§15).
- **Dashboards:** Operational visibility for Staff/Admin (the Operations Center's own real-time needs, `SYSTEM_ARCHITECTURE.md` §5) and for the engineering team's own infrastructure health — two distinct audiences, not one dashboard trying to serve both.
- **Operational Visibility:** The overall requirement this section serves — no environment, especially Production, operates without someone being able to see its current state at any time; per §14's anti-pattern, monitoring is never optional or an afterthought.

## 11. Secrets Management

- **Secrets:** Never committed to any repository, per `PROJECT_RULES.md` §16 and `SECURITY.md` §8 — managed exclusively through the Hosting platform's secret management (`TECH_STACK.md` §16).
- **Configuration:** Environment-specific configuration is externalized from code (`SYSTEM_ARCHITECTURE.md` §6), distinct from secrets specifically — a configuration value and a secret are handled through related but distinguishable mechanisms, since not every configuration value is sensitive.
- **Environment Variables:** Used for both configuration and secret injection at the platform level, never for storing a secret in a way that risks it being logged or exposed client-side by accident (`TECH_STACK.md` §16, `SECURITY.md` §8).
- **Rotation:** Per `SECURITY.md` §8/§16 — periodic rotation of API keys and service credentials; exact cadence remains that document's Open Decision, not re-decided here.
- **Least Privilege:** Per `SECURITY.md` §2 and `ADR-0006`'s cross-module access rule — every secret/credential grants access to exactly what its owning service needs, nothing broader.

## 12. Cost Governance

- **Infrastructure Cost:** Hosting, Database, Cache, and Object Storage costs are tracked against actual usage, not provisioned speculatively ahead of demonstrated need — the direct operational expression of `ARCHITECTURE_PRINCIPLES.md` Principle 26.
- **AI Cost:** LLM Gateway usage (`TECH_STACK.md` §11) is a cost category with a materially different scaling curve than traditional infrastructure — tracked separately, not folded into general infrastructure cost, so its growth is visible on its own terms.
- **Storage Cost:** Object Storage and Database storage growth (particularly `Route` location-ping data and `Notification` records, both flagged in `DATABASE_DESIGN.md` §20 as open retention-duration questions) directly affects cost — this document doesn't resolve those retention questions, but flags that their resolution has a real cost dimension, not only a compliance one.
- **Monitoring Cost:** Sentry and any future observability tooling (`TECH_STACK.md` §13) has its own cost profile, tracked rather than assumed negligible as usage scales.
- **Scaling Cost:** Every scaling decision in §7 is evaluated for cost impact before being adopted — horizontal scaling, read replicas, and any future multi-region deployment each have a real cost curve, not just a technical one.
- **Budget Reviews:** A recurring review of actual infrastructure spend against expectations — cadence is an Open Decision (§15), not invented here; the requirement that this review happens on some defined recurring basis, rather than only when a bill is unexpectedly high, is stated now.

## 13. Future Infrastructure

Directional only, none committed for a specific date:

- **Containers:** A candidate future packaging mechanism if/when module extraction (`SYSTEM_ARCHITECTURE.md` §5, §11) or a migration off Vercel (`ADR-0007`'s stated cost trade-off) ever becomes necessary.
- **Kubernetes:** A candidate future orchestration layer only if containerization (above) produces enough independently-deployed services to justify the operational complexity — not adopted prematurely, consistent with Cost-Aware Architecture and `TECH_STACK.md` §15's identical framing.
- **Edge Computing:** A candidate future optimization for latency-sensitive paths (Live Tracking, per `ARCHITECTURE_PRINCIPLES.md` Principle 13), compatible with but not committed to by the current Hosting choice (`TECH_STACK.md` §22).
- **Multi-Region:** Per §7 above and `SYSTEM_ARCHITECTURE.md` §14 — anticipated architecturally, not built now.
- **Multi-Cloud:** Not currently planned — a single managed cloud/hosting relationship is consistent with Cost-Aware Architecture at this stage; multi-cloud complexity would need a specific, demonstrated justification (e.g. a genuine data-residency requirement, `SECURITY.md` §13) before being adopted.

## 14. Anti-Patterns

Explicitly forbidden, without exception:

- Never deploy manually to production — per §4; CI/CD (`TECH_STACK.md` §14) is the only path to Production, without exception for urgency.
- Never hardcode configuration — per §11; every environment-specific value is externalized.
- Never mix environments — per §3's Isolation requirement; no shared database, secret, or credential across environments.
- Never bypass CI — per §4 and `PROJECT_RULES.md` §11.1–§11.2; the same discipline applies to infrastructure changes as to application code changes.
- Never expose secrets — per §11 and `SECURITY.md` §8/§15.
- Never ignore monitoring — per §10; no environment, especially Production, runs without active observability.

## 15. Open Decisions

Intentionally deferred — not invented here:

1. **Specific RPO/RTO numeric targets** (§9) — this document resolves *that* they will be explicitly defined, not yet *what* they are.
2. **Restore drill cadence** (§9) — not yet scheduled.
3. **Alert thresholds** (§10) — shared open item with `SECURITY.md` §16.
4. **Secret/key rotation cadence** (§11) — shared open item with `SECURITY.md` §16.
5. **Budget review cadence** (§12) — not yet defined.
6. **Hotfix/emergency deployment exception process** (§3) — whether an expedited promotion path exists for genuine emergencies, and what governs its use, is not decided here.
7. **Object Storage and managed-database provider selection** (§6) — category-level decisions made (`TECH_STACK.md` §7, this document), specific vendor not yet chosen.

---

## Related Documents
- `PROJECT_MANIFEST.md`, `ARCHITECTURE_PRINCIPLES.md` Principles 20–22, 26 — the founding commitments this document operationalizes
- `SYSTEM_ARCHITECTURE.md` §4–§7, §11, §13–§14 — the architecture this document's topology and deployment strategy implement operationally
- `TECH_STACK.md` §7–§9, §11, §13–§17, §23 — the technology choices this document deploys and operates
- `SECURITY.md` §2–§3, §8–§11, §16 — the trust boundaries and operational security requirements this document is built to satisfy
- `DATABASE_DESIGN.md` §14 — resolved in part by this document's §9
- `ADR-0002-modular-monolith.md`, `ADR-0006-database-baseline.md`, `ADR-0007-frontend-backend-hosting-stack.md` — the architectural decisions this document's infrastructure serves
- `PROJECT_RULES.md` §11–§14, §25 — the Git/CI/CD/Release process this document's deployment strategy enforces operationally

## Open Questions
1. Should `DATABASE_DESIGN.md` §14 be revised to reference this document's resolution (§9) explicitly, closing that forward reference the way other cross-document resolutions have been closed in recent turns? Flagged as a deliberate follow-up, not performed in this same pass.
2. Should Threat Modeling, already flagged as a candidate practice in `SECURITY.md` §14, be tied specifically to this document's Promotion Flow (§3) as a required Staging-to-Production gate, or remain a separate, undated future practice? Flagged for a governance decision, not made unilaterally here.

## Future ADR References
- Any future decision to adopt Containers, Kubernetes, or a migration off the current Hosting platform (§13) requires an ADR, consistent with `ADR-0007`'s own Future ADR Reference.
- Any decision to commit to Multi-Region or Multi-Cloud (§13) as an active roadmap item, not merely a future possibility, requires an ADR given how substantially it would change this document's core topology.
- Once specific RPO/RTO targets (§15, Open Decision #1) are set, if they later need to change materially (e.g. due to a compliance requirement), that change should be recorded with the same rigor as any other binding operational commitment — an ADR is recommended, though not strictly required, since RPO/RTO are operational targets rather than architectural decisions in the strictest sense.
