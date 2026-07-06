# BARQ Architecture Principles

- **Purpose:** Define the permanent engineering principles used to evaluate every future architectural decision in BARQ. This document does not describe the system architecture itself — that is `SYSTEM_ARCHITECTURE.md`. It defines the criteria that document, and every one after it, must be judged against.
- **Scope:** The 26 principles below, their justification, and their practical implications at the level of "what this rules in or out" — not specific technology choices.
- **Out of Scope:** The actual module/service map, database schema, or API contracts (owned by `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_STANDARDS.md` respectively). Implementation detail of any kind. Coding style.
- **Dependencies:** `PROJECT_MANIFEST.md` (Engineering Philosophy §6, AI Philosophy §7, Design Philosophy §8 — this document operationalizes those into evaluable principles), `PROJECT_RULES.md` (process rules this document's principles get enforced through), `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## How to Use This Document

Every architectural decision — recorded as an ADR, proposed as an RFC, or reviewed in an Architecture Review — should be checked against these 26 principles. When two principles appear to conflict in a specific case, the conflict is resolved using `PROJECT_MANIFEST.md` §12 (Decision Framework), not by silently favoring one principle over another. A decision that cannot be justified against at least the relevant principles here should not proceed to implementation.

**Rule — Every Principle Must Eventually Own a Document or ADR:** A principle may be listed here before its enforcing ADR or capability document exists — this document itself is intentionally written ahead of several such documents, consistent with how `ADR-0005` preceded the documents it binds. However, no principle may remain permanently unlinked. Each principle's "Related ADRs" field is either a real ADR/document reference or an explicit statement of which future document is expected to own it (as most entries below already state). During Phase 0 completion review, and at any subsequent Architecture Review of this document, any principle still lacking both a governing ADR and an identified owning document is treated as a defect in this document, not an acceptable permanent state.

---

## 1. Documentation First

- **Why it exists:** Code without a preceding decision record is a decision nobody can inspect, question, or trust. See `PROJECT_MANIFEST.md` Quality Standard §11.
- **What it means:** No architectural or feature work begins until a document describing it has passed at least one Architecture Review.
- **What it prevents:** Undocumented tribal knowledge; architecture that exists only in someone's head or in code comments no one reads.
- **Practical implications:** A pull request implementing something with no corresponding approved document is rejected regardless of code quality.
- **Related ADRs:** None yet — this principle is enforced procedurally via `PROJECT_RULES.md` §1, not via a standalone ADR.

## 2. Single Source of Truth (SSOT)

- **Why it exists:** Duplicated truth drifts; two documents or two code paths stating the same rule will eventually disagree.
- **What it means:** Every fact, rule, or decision has exactly one owning location. Everything else references it.
- **What it prevents:** Contradictory documentation, contradictory business logic, and the maintenance burden of updating the same fact in multiple places.
- **Practical implications:** Reviewers actively check for restated (not referenced) content as a blocking finding, per `PROJECT_RULES.md` §3.
- **Related ADRs:** None yet.

## 3. Progressive Documentation

- **Why it exists:** Large, one-pass documents are reviewed poorly and become stale quickly; small, focused, versioned documents can be kept accurate.
- **What it means:** Documents are written short, matured through defined lifecycle stages (`PROJECT_RULES.md` §10), and split rather than allowed to grow unbounded.
- **What it prevents:** Monolithic, unreviewable documentation; the temptation to treat documentation as a one-time exercise instead of a living system.
- **Practical implications:** A document that starts covering too much ground is split during Architecture Review, not carried forward as-is.
- **Related ADRs:** `ADR-0003-documentation-order.md`.

## 4. Domain-Driven Design

- **Why it exists:** BARQ's business — Bookings, Providers, Pricing, Wallet, Identity, and more — has enough real complexity that generic CRUD thinking would produce a system that doesn't match how the business actually works.
- **What it means:** The system is organized around Bounded Contexts with their own ubiquitous language (`GLOSSARY.md`), not around technical layers or database tables.
- **What it prevents:** A "big ball of mud" where every concept leaks into every other concept because nothing has a clear owning context.
- **Practical implications:** Every new capability is first asked "which Bounded Context does this belong to" before any design work starts. Full elaboration is owned by `DOMAIN_MODEL.md`.
- **Related ADRs:** None yet — `DOMAIN_MODEL.md` will likely produce one when the initial context map is decided.

## 5. Clean Architecture

- **Why it exists:** Business logic that depends on frameworks, databases, or UI becomes impossible to change, test, or reason about independently.
- **What it means:** Dependencies point inward — domain logic knows nothing about HTTP, persistence technology, or presentation; outer layers depend on inner layers, never the reverse.
- **What it prevents:** A domain model that can't be tested without a database; business rules scattered across controllers and UI components.
- **Practical implications:** Domain code cannot import framework/infrastructure code. Violations are a blocking code review finding once implementation begins (`PROJECT_RULES.md` §14).
- **Related ADRs:** None yet.

## 6. Modular Monolith

- **Why it exists:** BARQ needs the deployment simplicity of a single application at its current stage, without giving up the internal separation that would let it evolve later. Full reasoning is owned by `ADR-0002-modular-monolith.md` — not restated here.
- **What it means:** One deployable application, internally divided into modules aligned to Bounded Contexts, with enforced boundaries between them.
- **What it prevents:** Both extremes — an undifferentiated monolith with no internal boundaries, and premature microservices complexity BARQ doesn't yet need.
- **Practical implications:** Module boundary violations are a blocking review finding (`PROJECT_RULES.md` §21), not a style preference.
- **Related ADRs:** `ADR-0002-modular-monolith.md`.

## 7. API First

- **Why it exists:** Mobile apps, the admin dashboard, the operations center, and AI Agents all need to consume the same backend capability through the same contract — the API is a product surface, not an afterthought to the UI.
- **What it means:** API contracts are designed and documented before the endpoints are implemented, and before the UI that consumes them.
- **What it prevents:** APIs shaped accidentally by whatever a specific UI screen needed first, then awkwardly generalized later for the next consumer.
- **Practical implications:** `API_STANDARDS.md`, `REST_API.md`, `EVENTS.md`, and `WEBHOOKS.md` (not yet written) will be the enforcement layer for this principle.
- **Related ADRs:** None yet.

## 8. AI First

- **Why it exists:** Per `PROJECT_MANIFEST.md` AI Philosophy §7, AI is a designed-in capability with explicit boundaries, not a bolt-on feature added after the "real" product is built.
- **What it means:** Domains and APIs are designed with AI Agent consumption in mind from the start — not exclusively human-driven UI flows that AI has to awkwardly reverse-engineer later.
- **What it prevents:** An architecture where adding an AI Agent later requires invasive changes because nothing was built to be machine-consumable.
- **Practical implications:** When any capability document is written, it should consider whether/how an AI Agent might need to act within that domain, even if the agent itself ships later. Full detail owned by `AI_STRATEGY.md`.
- **Related ADRs:** None yet.

## 9. Mobile First

- **Why it exists:** BARQ's primary customer surface is a mobile app; per `PROJECT_MANIFEST.md` Design Philosophy §8, this is an identity commitment, not a responsive-design afterthought.
- **What it means:** Design and technical decisions (payload size, latency tolerance, offline/poor-connectivity behavior) are made for mobile constraints first, with desktop/admin surfaces as a secondary consideration where relevant.
- **What it prevents:** A desktop-shaped product with a mobile skin bolted on, which tends to produce heavy, slow, awkward mobile experiences.
- **Practical implications:** API payloads, image handling, and notification strategy are evaluated against mobile network conditions in Oman/GCC, not assumed broadband.
- **Related ADRs:** None yet.

## 10. Bilingual by Design

- **Why it exists:** Fully governed by `ADR-0005-bilingual-architecture.md` — referenced here, not restated, per SSOT (Principle 2).
- **What it means:** Arabic (default) and English (first-class) have full parity across product, UX, AI, APIs, database, and documentation, from day one, permanently.
- **What it prevents:** Arabic becoming a translation layer bolted onto an English-shaped architecture — the single most common failure mode this principle exists to rule out.
- **Practical implications:** No feature, component, or API is complete in one language only. Domain/API/database layers remain language-neutral; language lives at the presentation and content layers. See `PROJECT_RULES.md` §18 for enforcement.
- **Related ADRs:** `ADR-0005-bilingual-architecture.md`.

## 11. Security by Design

- **Why it exists:** A platform moving customer money, provider payouts, and personal data cannot treat security as a pre-launch checklist — it has to be a property of the architecture itself.
- **What it means:** Threat modeling and authorization boundaries are considered at design time, not retrofitted after a feature works functionally.
- **What it prevents:** Security vulnerabilities that are architecturally baked in and expensive to fix later (e.g. authorization checks scattered ad hoc instead of centralized).
- **Practical implications:** Full detail owned by `SECURITY.md`, which also sets the binding minimums referenced in `PROJECT_RULES.md` §16.
- **Related ADRs:** None yet.

## 12. Privacy by Design

- **Why it exists:** BARQ holds customer identity, location (Live Tracking), and financial data across Oman and future GCC markets, each with its own data-protection expectations.
- **What it means:** Data collection is scoped to what's needed for the feature it serves; personal data handling is a first-class design consideration, not a compliance afterthought.
- **What it prevents:** Over-collection of personal data, and the retrofitting cost of adding privacy controls after data models are already built without them.
- **Practical implications:** Full detail owned by `COMPLIANCE_AND_LEGAL.md` (not yet written) — particularly Oman PDPL implications flagged in earlier planning.
- **Related ADRs:** None yet.

## 13. Performance by Design

- **Why it exists:** Live Tracking, Booking creation, and Notifications are latency-sensitive by nature; performance problems in these domains are architecture problems, not tuning problems, if not considered early.
- **What it means:** Expected load and latency targets are stated in a feature's specification before implementation, especially for the domains named above.
- **What it prevents:** Architectures that "happen to be slow" because performance was never a design input, only a post-launch firefight.
- **Practical implications:** See `PROJECT_RULES.md` §17 for the current binding minimum; full detail owned by future architecture/capability docs.
- **Related ADRs:** None yet.

## 14. Accessibility by Design

- **Why it exists:** A premium product that excludes users with accessibility needs is not actually premium — and per `ADR-0005`, accessibility must hold equally in Arabic/RTL and English/LTR.
- **What it means:** Accessibility (contrast, touch targets, screen reader support, RTL-aware accessibility) is a design system input, not a post-launch audit.
- **What it prevents:** Accessibility treated as a checklist run once near launch, disconnected from how components were actually built.
- **Practical implications:** Full detail owned by `ACCESSIBILITY.md`, which also sets the binding minimum referenced in `PROJECT_RULES.md` §19.
- **Related ADRs:** None yet.

## 15. Event-Driven Thinking

- **Why it exists:** Many BARQ domains are naturally event-shaped (a Booking is created, a Driver arrives, a payout completes) and modeling them as events — not just CRUD state changes — keeps domains decoupled inside the Modular Monolith.
- **What it means:** Significant domain occurrences are modeled and named as events (see future `EVENTS.md`), which other modules can react to without being tightly coupled to the module that raised them.
- **What it prevents:** Modules reaching directly into each other to trigger side effects, which would violate Modular Monolith boundaries (Principle 6) even without a network call.
- **Practical implications:** Cross-module reactions (e.g. Notifications reacting to a Booking event) are designed as event subscriptions, not direct calls. Full detail owned by `EVENTS.md` (not yet written).
- **Related ADRs:** None yet.

## 16. Explicit over Implicit

- **Why it exists:** Implicit behavior (hidden defaults, "magic" conventions no one wrote down) is exactly what makes a system hard for a new engineer — or an AI Agent — to reason about safely.
- **What it means:** Behavior, especially anything affecting money, access, or data, is stated explicitly in documentation and code rather than inferred from convention alone.
- **What it prevents:** Surprises — a rule that "everyone just knows" until someone new doesn't, and a bug ships.
- **Practical implications:** Guardrails, permissions, and business rules are written down, not assumed to be obvious from context.
- **Related ADRs:** None yet.

## 17. Simplicity over Cleverness

- **Why it exists:** Clever code is expensive to maintain, review, and hand off; BARQ optimizes for a team (human and AI) understanding the system correctly, not for minimal line count.
- **What it means:** When two solutions are otherwise equivalent, the simpler, more obvious one is chosen — even if a cleverer one is theoretically more elegant.
- **What it prevents:** Codebases where only the original author can safely modify a given piece of logic.
- **Practical implications:** Code review (`PROJECT_RULES.md` §14) treats "this is unnecessarily clever" as a legitimate reason to request simplification.
- **Related ADRs:** None yet.

## 18. Composition over Duplication

- **Why it exists:** Duplicated logic (Principle 2's concern, applied to code specifically) drifts out of sync the same way duplicated documentation does.
- **What it means:** Shared behavior is extracted and composed/reused, not copy-pasted across modules or Bounded Contexts.
- **What it prevents:** Two "almost identical" implementations of the same business rule that quietly diverge over time.
- **Practical implications:** If two Bounded Contexts seem to need the same logic, that's a signal to reconsider the boundary or extract a shared kernel, per `PROJECT_RULES.md` §22 — not to duplicate.
- **Related ADRs:** None yet.

## 19. Convention over Configuration

- **Why it exists:** Excessive configurability for things that have one obviously correct answer slows the team down and creates more surface area for inconsistency.
- **What it means:** Sensible, documented defaults are established once (e.g. naming conventions in `GLOSSARY.md` and `PROJECT_RULES.md` §23) and followed, rather than re-decided per feature.
- **What it prevents:** Every new module inventing its own local conventions, making the codebase feel like several different projects stitched together.
- **Practical implications:** Deviating from an established convention requires justification in review, not just preference.
- **Related ADRs:** None yet.

## 20. Observability by Design

- **Why it exists:** A production platform that can't be observed can't be operated — issues in Live Tracking, Bookings, or Payments need to be diagnosable in real time, not reconstructed after the fact.
- **What it means:** Logging, metrics, and tracing needs are considered part of a feature's design, not added reactively after an incident.
- **What it prevents:** "Flying blind" in production, especially in the Operations Center, which depends entirely on this principle being upheld elsewhere.
- **Practical implications:** Full detail owned by `OBSERVABILITY.md` and `AUDIT_AND_ACTIVITY_LOGGING.md` (not yet written) — note these remain distinct per the Activity Log/Audit Log split in `GLOSSARY.md`.
- **Related ADRs:** None yet.

## 21. Scalability by Design

- **Why it exists:** BARQ's stated trajectory is Oman first, then GCC expansion — an architecture that only works at single-country scale would require a rewrite, not a rollout, when that expansion happens.
- **What it means:** Multi-tenancy, data partitioning, and load considerations are designed in from the start, even though only one market is live initially.
- **What it prevents:** A costly re-architecture at the exact moment the business is trying to move fast into a new market.
- **Practical implications:** Full detail owned by `MULTI_TENANCY_AND_SCALABILITY.md` (not yet written) — this principle is why that document exists as its own artifact rather than a footnote in `SYSTEM_ARCHITECTURE.md`.
- **Related ADRs:** None yet.

## 22. Fail Gracefully

- **Why it exists:** Third-party dependencies BARQ relies on (WhatsApp API, payment gateway, maps/location providers) will occasionally fail or degrade — the platform's behavior in that moment is a design decision, not an accident.
- **What it means:** Every integration and critical path has a defined degraded/fallback behavior, not just a happy path.
- **What it prevents:** A single third-party outage cascading into a full platform outage or a silently broken feature no one notices until a customer complains.
- **Practical implications:** Full detail owned by `INTEGRATIONS.md` (not yet written), which should state fallback behavior per integration, per the earlier gap analysis that flagged this need.
- **Related ADRs:** None yet.

## 23. Human-in-the-Loop for High-Risk Actions

- **Why it exists:** Per `PROJECT_MANIFEST.md` AI Philosophy §7, AI accelerates the team and its users but never acts as an unaccountable black box on consequential actions.
- **What it means:** Any AI Agent action that could affect money, trust, or personal data requires a human review/approval point before it takes effect.
- **What it prevents:** Autonomous AI actions with real-world financial or trust consequences that no human ever reviewed before they happened.
- **Practical implications:** Enforced procedurally now via `PROJECT_RULES.md` §20.1; full guardrail detail owned by `AI_GUARDRAILS.md` (not yet written).
- **Related ADRs:** None yet.

## 24. Business Rules Belong to the Domain Layer

- **Why it exists:** A direct consequence of Clean Architecture (Principle 5) and DDD (Principle 4) — business rules (commission calculation, booking eligibility, refund policy) are the most valuable, most-changed part of the system and must live in one findable place.
- **What it means:** Business rules live in domain services/entities, not scattered across API controllers, database triggers, or UI form logic.
- **What it prevents:** The same business rule being implemented (and inevitably diverging) in the mobile app, the admin dashboard, and the backend simultaneously.
- **Practical implications:** A rule like a commission tier calculation is defined once in the domain layer and consumed everywhere else — never re-implemented at the edge for convenience.
- **Related ADRs:** None yet.

## 26. Cost-Aware Architecture

- **Why it exists:** BARQ is an early-stage startup platform before it is a mature GCC-wide operation. Scalability (Principle 21) is a real requirement, but scalability pursued without regard for cost is its own failure mode — infrastructure spend that outpaces revenue or runway can kill a platform before it ever reaches the scale it was over-built for.
- **What it means:** Architecture is chosen to be scalable *and* financially responsible at the same time, with explicit weight given to the startup's current stage — especially during MVP and early operation — rather than optimizing for a scale BARQ has not yet reached.
- **What it prevents:** Premature infrastructure spend, over-engineering for hypothetical future load, and adopting paid managed services where a simpler, reliable, cheaper option meets the actual current need. It also prevents the opposite failure — choosing something so cheap it can't scale at all — Cost-Aware Architecture is a balance against Principle 21, not a override of it.
- **Practical implications:** When a design choice offers a meaningfully cheaper option that still meets reliability, security, and scalability requirements at BARQ's current and near-term stage, the cheaper option is preferred. Choosing a more expensive or complex option over a simpler sufficient one requires explicit justification in review — cost is a first-class design input, not something considered only after the fact when a bill arrives.
- **Related ADRs:** None yet. Expected to be exercised concretely by `DEPLOYMENT_AND_INFRASTRUCTURE.md` and `FINANCIAL_MODEL.md` (both not yet written) — those documents own the actual cost/infrastructure tradeoff decisions this principle governs.

---

## Related Documents
- `PROJECT_MANIFEST.md` — the philosophy these principles operationalize; referenced throughout, not restated
- `PROJECT_RULES.md` — the process rules that enforce these principles day to day
- `GLOSSARY.md` — canonical terminology referenced throughout
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md` — the two principles here that are already the subject of a Locked ADR
- `DOMAIN_MODEL.md`, `SYSTEM_ARCHITECTURE.md`, `SECURITY.md`, `ACCESSIBILITY.md`, `AI_STRATEGY.md`, `DEPLOYMENT_AND_INFRASTRUCTURE.md` — each owns the full implementation detail for the principle(s) it corresponds to
- `MULTI_TENANCY_AND_SCALABILITY.md`, `COMPLIANCE_AND_LEGAL.md`, `OBSERVABILITY.md`, `AUDIT_AND_ACTIVITY_LOGGING.md`, `INTEGRATIONS.md`, `AI_GUARDRAILS.md`, `EVENTS.md`, `API_STANDARDS.md`, `FINANCIAL_MODEL.md` *(not yet written)* — each will own the full implementation detail for the principle(s) it corresponds to, once written

## Open Questions
1. Should this document eventually state an explicit precedence order among the 26 principles for the cases where `PROJECT_MANIFEST.md` §12's Decision Framework doesn't cleanly resolve a conflict (e.g. Simplicity over Cleverness vs. Scalability by Design, or the new Cost-Aware Architecture vs. Scalability by Design, which can genuinely pull in opposite directions)? Flagging rather than deciding unilaterally.

## Future ADR References
- Any future addition, removal, or substantive redefinition of a principle in this document requires an ADR, consistent with this document's Locked status once approved.
- `DOMAIN_MODEL.md`'s initial context map (Principle 4) and `SYSTEM_ARCHITECTURE.md`'s module boundary decisions (Principle 6) are each expected to produce their own ADRs when written.
- `DEPLOYMENT_AND_INFRASTRUCTURE.md` and `FINANCIAL_MODEL.md` are expected to produce the first concrete ADRs exercising Principle 26 (Cost-Aware Architecture) once real infrastructure choices are on the table.
