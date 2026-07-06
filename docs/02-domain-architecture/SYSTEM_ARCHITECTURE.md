# BARQ System Architecture

- **Purpose:** Define BARQ's complete software architecture — how BARQ is built. This is the authoritative technical architecture for the entire platform.
- **Scope:** Architecture style, layering, module architecture, cross-cutting concerns, communication patterns, architectural boundaries, technology decisions, performance/scalability/security strategy, failure strategy, deployment view, and long-term architectural evolution.
- **Out of Scope:** Database tables (owned by `DATABASE_DESIGN.md`), API contracts (owned by `API_STANDARDS.md`/`REST_API.md`, not yet written), UI design (owned by `DESIGN_SYSTEM.md`), any implementation or code.
- **Dependencies:** `PROJECT_MANIFEST.md`, `PROJECT_RULES.md`, `ARCHITECTURE_PRINCIPLES.md` (every architectural goal and boundary below is that document's 26 principles applied concretely), `DOMAIN_MODEL.md` (§5's module architecture maps directly to its 15 Bounded Contexts — no new business structure is introduced here), `PRODUCT_REQUIREMENTS.md` (§5/§7 — V1 module scope), `BUSINESS_MODEL.md` (§12 — Scalability Strategy), `AI_STRATEGY.md` (§6, §12 — AI Layer and AI Governance), `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## 1. Executive Architecture Summary

BARQ is built as a **Modular Monolith** (`ADR-0002`): one deployable application, internally organized into modules that map one-to-one with the Bounded Contexts already defined in `DOMAIN_MODEL.md`. Each module owns its own domain logic behind a Clean Architecture boundary (Presentation → Application → Domain → Infrastructure), communicates with other modules primarily through domain events rather than direct calls, and is designed — per `ARCHITECTURE_PRINCIPLES.md` Principle 21 — to be extractable into an independent service later without a rewrite, if and when real scale ever requires it. An AI Layer sits alongside the business modules as a first-class citizen (Principle 8, AI First), consuming module capabilities through the same governed interfaces every other consumer uses, never through backdoor access to another module's data. The platform is bilingual by design at every layer (`ADR-0005`), mobile-first at the presentation layer (Principle 9), and deliberately cost-aware in its technology choices for this stage of the company (Principle 26). This document states how these commitments become a real system; it does not repeat why they exist — that is `ARCHITECTURE_PRINCIPLES.md`'s job.

## 2. Architectural Goals

Each goal below is a named principle in `ARCHITECTURE_PRINCIPLES.md`, referenced not restated: **Scalability** (Principle 21), **Maintainability** (Principles 2, 5, 17–19), **Performance** (Principle 13), **Security** (Principle 11), **Cost Awareness** (Principle 26), **AI Readiness** (Principle 8), **Bilingual by Design** (Principle 10 / `ADR-0005`), **Reliability** (Principle 22), **Observability** (Principle 20), **Developer Experience** (Principles 16–19, Explicit over Implicit / Simplicity / Composition / Convention). This document's job is to satisfy all ten simultaneously — where two goals pull in different directions on a specific decision (e.g. Cost Awareness vs. Scalability), the resolution is stated at the point of that decision below, not left ambiguous.

## 3. Architecture Style

BARQ uses a **Modular Monolith**, per `ADR-0002-modular-monolith.md` — referenced in full, not restated here. In summary: one deployable application, internally divided into modules aligned to Bounded Contexts, with enforced boundaries between them (`ARCHITECTURE_PRINCIPLES.md` Principle 6).

**Why Microservices are intentionally postponed:** Microservices solve problems BARQ does not yet have — independent scaling of specific capabilities under real load, independent team ownership at a scale where a monolith's coordination cost exceeds its simplicity benefit, and polyglot technology needs. At Salalah-launch scale (`PRODUCT_REQUIREMENTS.md` §5), none of these problems exist yet, while the *costs* of microservices — network overhead, distributed transaction complexity, operational burden, and infrastructure spend — are real and immediate. Adopting microservices now would directly violate `ARCHITECTURE_PRINCIPLES.md` Principle 26 (Cost-Aware Architecture): premature infrastructure complexity chosen for a scale BARQ has not reached. The Modular Monolith preserves the *option* to extract services later (§5's "Future Extraction Potential" per module, §11) without paying that cost today.

## 4. High-Level Architecture

Seven layers, applied uniformly across every module:

- **Presentation Layer:** Customer Web App, Provider Portal, Operations Center, Admin Dashboard (per `PRODUCT_REQUIREMENTS.md` §5). Mobile-first, bilingual (RTL/LTR), premium-light per `PROJECT_MANIFEST.md` Design Philosophy §8. Contains no business logic (`ARCHITECTURE_PRINCIPLES.md` Principle 25).
- **Application Layer:** Orchestrates use cases (e.g. "confirm a Booking") by coordinating Domain Layer objects and Infrastructure Layer services. Contains workflow, not business rules.
- **Domain Layer:** Owns business entities, invariants, and rules exactly as defined in `DOMAIN_MODEL.md` (Principle 24). Has no dependency on any other layer (Clean Architecture, Principle 5) — it does not know about HTTP, the database, or the UI.
- **Infrastructure Layer:** Technical concerns — persistence implementation, external service clients, messaging. Implements interfaces the Domain/Application layers define, never the reverse (dependency inversion).
- **AI Layer:** Hosts every AI Agent role defined in `AI_STRATEGY.md` §3. Consumes other modules' Application-Layer interfaces like any other consumer; never reaches directly into another module's Domain or Infrastructure layer. Subject to `AI_STRATEGY.md` §4's boundaries at all times, enforced architecturally (permission layer), not just procedurally.
- **Integration Layer:** External-world boundary — WhatsApp, Maps/Geolocation, Payment Gateway, and any future third-party integration (full catalog owned by future `INTEGRATIONS.md`). Isolates the rest of the system from third-party API shape/behavior changes.
- **Persistence Layer:** Data storage mechanics. Structure owned entirely by `DATABASE_DESIGN.md` — this document states only that it exists as a layer and that Domain Layer code never depends on it directly (dependency inversion again).

## 5. Module Architecture

Each module below corresponds exactly to a Bounded Context already defined in `DOMAIN_MODEL.md` §1 — no new business structure is introduced here, only its technical shape.

### Identity
- **Purpose/Responsibilities:** Per `DOMAIN_MODEL.md` §1 — unchanged, referenced not repeated.
- **Dependencies:** None (foundational — every other module depends on Identity, not the reverse).
- **Events Produced:** User Registered, User Verified.
- **Events Consumed:** None.
- **Future Extraction Potential:** Low-to-Medium. Identity is foundational and tightly consulted by every module; extraction would require every module to switch to network calls for something currently near-zero-latency in-process. Candidate only if authentication load specifically becomes a bottleneck independent of the rest of the system.

### Customer
- **Dependencies:** Identity.
- **Events Produced:** (Customer-specific lifecycle events — full catalog owned by future `EVENTS.md`.)
- **Events Consumed:** User Registered.
- **Future Extraction Potential:** Low. Thin module, tightly coupled to Identity and Booking; little standalone scaling benefit.

### Provider
- **Dependencies:** Identity, Administration (approval authority), Contracts (Active Contract required for Approval).
- **Events Produced:** Provider Applied, Provider Approved, Provider Suspended, Driver Registered, Guide Registered, Vehicle Registered.
- **Events Consumed:** Admin Configuration Changed (tier policy).
- **Future Extraction Potential:** Medium. Provider onboarding/verification volume could grow independently of Booking volume during expansion phases (`BUSINESS_MODEL.md` §12); a plausible first extraction candidate if that divergence becomes real.

### Booking
- **Dependencies:** Customer, Provider, Pricing.
- **Events Produced:** Booking Created, Booking Confirmed, Booking Cancelled, Booking Disputed.
- **Events Consumed:** Provider Approved/Suspended (affects bookability), Price Set, Commission Calculated.
- **Future Extraction Potential:** Low, for now — it's the platform's core transactional module and benefits most from staying in-process with strong consistency guarantees (see §8, dependency direction). Highest-scrutiny candidate if it ever is extracted, given its centrality.

### Pricing
- **Dependencies:** Provider.
- **Events Produced:** Price Set, Commission Calculated, Commission Tier Changed.
- **Events Consumed:** Provider Approved (tier assignment trigger).
- **Future Extraction Potential:** Low. Tightly coupled to Booking's confirmation-time calculation; extraction would add latency to the platform's most latency-sensitive path (`PRODUCT_REQUIREMENTS.md` §8).

### Wallet
- **Dependencies:** Payments, Pricing.
- **Events Produced:** Wallet Transaction Recorded, Payout Processed.
- **Events Consumed:** Payment Received, Commission Calculated, Refund Issued.
- **Future Extraction Potential:** Medium-to-High. Ledger-integrity concerns (immutability, append-only, per `DOMAIN_MODEL.md` Wallet Transaction invariant) benefit from strong isolation; a natural second extraction candidate after Provider, if audit/compliance requirements eventually demand a dedicated ledger service.

### Payments
- **Dependencies:** Booking, Pricing.
- **Events Produced:** Payment Received, Payment Failed, Refund Issued.
- **Events Consumed:** Booking Confirmed.
- **Future Extraction Potential:** Medium. Payment Gateway integration (Integration Layer) is already an external boundary; formal extraction mainly adds value if PCI-relevant isolation becomes a compliance requirement.

### Contracts
- **Dependencies:** Provider, Customer.
- **Events Produced:** Contract Sent, Contract Signed.
- **Events Consumed:** Provider Applied.
- **Future Extraction Potential:** Low. Low volume, low coupling benefit from extraction.

### Invoices (Invoicing)
- **Dependencies:** Booking, Payments, Pricing.
- **Events Produced:** Invoice Generated.
- **Events Consumed:** Booking Confirmed/Completed, Payment Received.
- **Future Extraction Potential:** Medium. PDF generation (§10) is CPU/IO-bound and a reasonable candidate for extraction into an independently-scaled worker even before a full service extraction.

### Notifications
- **Dependencies:** Every other module, as a downstream reactor to their events (per `DOMAIN_MODEL.md` §1, Notifications context).
- **Events Produced:** Notification Sent, Notification Delivery Failed.
- **Events Consumed:** Nearly every event in the catalog (`DOMAIN_MODEL.md` §3) — this module is structurally the platform's primary event consumer.
- **Future Extraction Potential:** High. Naturally async, naturally isolated by the event-consumer pattern already in place; one of the strongest candidates for early extraction if notification volume scales faster than the rest of the platform.

### Tracking
- **Dependencies:** Booking, Provider (Driver/Guide/Vehicle assignment).
- **Events Produced:** Journey Started, Journey Completed, Journey Interrupted.
- **Events Consumed:** Booking Confirmed.
- **Future Extraction Potential:** High. Live-location data is high-frequency, write-heavy, and largely independent of the rest of the domain once a Journey is underway — a strong long-term extraction candidate, particularly if real-time infrastructure needs diverge from the rest of the platform's request/response profile.

### Support
- **Note:** Per `DOMAIN_MODEL.md` §1, `Support Ticket` is owned by the **Operations** Bounded Context — there is no separate Support Bounded Context in the domain model. This document does not introduce one at the architecture level either, to avoid a structural inconsistency between documents. "Support" is addressed under **Operations**, below, not as its own module. Flagged explicitly rather than silently diverging from `DOMAIN_MODEL.md`.

### Reviews
- **Dependencies:** Booking, Customer, Provider.
- **Events Produced:** Review Submitted.
- **Events Consumed:** Booking Completed.
- **Future Extraction Potential:** Low. Low write volume relative to Booking/Tracking; no strong extraction case.

### Operations (includes Support Ticket handling)
- **Dependencies:** Booking, Tracking, Provider, Customer.
- **Events Produced:** (Support Ticket lifecycle events — full catalog owned by future `EVENTS.md`.)
- **Events Consumed:** Booking Disputed, Journey Interrupted, and effectively any event relevant to real-time oversight.
- **Future Extraction Potential:** Medium. The Operations Center's real-time read-model needs (§7) may eventually justify a dedicated read-optimized service, separate from write-side extraction of the modules it observes.

### Administration
- **Dependencies:** Provider, Pricing (tier policy authority), Identity.
- **Events Produced:** Admin Configuration Changed.
- **Events Consumed:** Provider Applied.
- **Future Extraction Potential:** Low. Low volume, high-sensitivity configuration authority — benefits more from staying tightly integrated and auditable in-process than from independent scaling.

### AI
- **Dependencies:** Every module it is explicitly authorized to consume, per role, per `AI_STRATEGY.md` §3 — always through Application-Layer interfaces, never direct Domain/Infrastructure access (§4 above).
- **Events Produced:** AI Recommendation Generated, AI Action Escalated for Human Review.
- **Events Consumed:** Varies per AI role (e.g. Customer Assistant consumes Booking/Provider read-access events; Finance Assistant consumes Wallet events for summarization only, never for action per `AI_STRATEGY.md`'s absolute Finance Assistant restriction).
- **Future Extraction Potential:** High. AI workloads have a fundamentally different resource profile (model inference) from the rest of the platform and are a strong candidate for early extraction into dedicated infrastructure, independent of whether the business modules themselves ever get extracted.

## 6. Cross-Cutting Concerns

- **Authentication:** Owned by Identity module; consumed by every Presentation-Layer entry point uniformly.
- **Authorization:** Enforced at the Application Layer boundary of every module — a request is authorized before it reaches Domain Layer logic, never left to the Domain Layer to self-police.
- **Logging:** Structural distinction between Activity Log and Audit Log preserved exactly as defined in `GLOSSARY.md` terms 26–27 and `ARCHITECTURE_PRINCIPLES.md` Principle 20 — two concerns, never merged into one stream.
- **Audit:** Every action listed as Audit-Logged in `DOMAIN_MODEL.md` (Staff, Admin, AI actions) is captured at the Application Layer, uniformly, not per-module reinvention.
- **Caching:** Applied at the Infrastructure Layer, transparent to Domain Layer logic — a caching failure degrades performance, never correctness (a cache is never the source of truth for Wallet balance or Commission calculation, both of which remain live Domain Layer reads per `DOMAIN_MODEL.md` invariants).
- **Localization:** Enforced architecturally per `ADR-0005` — the Domain/Application Layers remain language-neutral; language resolution happens at the Presentation Layer boundary and in content storage, never inside business logic (Principle 24 corollary).
- **Configuration:** Environment-specific configuration is externalized from code (Convention over Configuration, Principle 19, applied to config itself — sensible defaults, minimal per-environment divergence).
- **Validation:** Input validation occurs at the Application Layer boundary before Domain Layer logic executes — the Domain Layer can assume validated input, consistent with Clean Architecture's separation of concerns.
- **Error Handling:** Errors are explicit and typed at each layer boundary (Principle 16, Explicit over Implicit) — no silent failure, ever, in a path touching money, trust, or Booking state.
- **Feature Flags:** Used for staged rollout of new capability, never used to silently ship an incomplete bilingual feature (per `ADR-0005` — a feature flag cannot be the mechanism by which "Arabic later" happens).
- **Observability:** Per Principle 20 — every module emits the telemetry `OBSERVABILITY.md` (not yet written) will define; this document establishes that observability is designed in per-module, not bolted on.
- **Security:** Enforced at every layer boundary, especially Application Layer entry points; full detail owned by `SECURITY.md`.
- **AI Governance:** Every AI module interaction is subject to `AI_STRATEGY.md` §4's boundaries, enforced at the same Application Layer authorization point as any other actor — an AI Agent is architecturally just another authenticated, authorized actor with a narrower permission set, not a privileged bypass.

## 7. Communication Patterns

- **Request/Response:** Standard synchronous pattern for Presentation Layer → Application Layer interactions within a module.
- **Domain Events:** The primary cross-module communication mechanism (per `ARCHITECTURE_PRINCIPLES.md` Principle 15, Event-Driven Thinking) — a module publishes an event; interested modules subscribe, without the publisher knowing or caring who's listening. This is what keeps modules decoupled inside the Modular Monolith even without network boundaries.
- **Internal Events:** Used within a module for internal workflow steps that don't cross module boundaries — distinct from Domain Events, which are the only events other modules may subscribe to.
- **Background Jobs:** Used for non-time-critical work (e.g. Invoice PDF generation, per §5's note on Invoicing's extraction potential).
- **Scheduled Jobs:** Used for periodic concerns (e.g. Availability slot expiry checks) — full catalog owned by future technical design, not this document.
- **External Integrations:** Occur exclusively through the Integration Layer (§4) — no module calls WhatsApp, a Payment Gateway, or a Maps provider directly from its own Domain/Application code.

## 8. Architectural Boundaries

- **What each layer may access:** Presentation → Application only. Application → Domain and Infrastructure interfaces (not implementations). Domain → nothing outside itself (pure business logic). Infrastructure → external systems and persistence, implementing interfaces Domain/Application define. AI Layer → other modules' Application Layer interfaces only, per its authorized scope.
- **What each layer may never access:** Presentation never accesses Domain or Infrastructure directly. Domain never accesses Infrastructure, Presentation, or any framework/technology-specific code (Clean Architecture, Principle 5). No module's Domain or Infrastructure Layer is ever accessed directly by another module — all cross-module access is via Application Layer interfaces or Domain Events, never a shortcut through internals (Modular Monolith boundary enforcement, Principle 6).
- **Dependency Direction:** Always inward — outer layers (Infrastructure, Presentation) depend on inner layers (Domain, Application); the Domain Layer depends on nothing.
- **Allowed Coupling:** A module may depend on another module's published Application Layer interface or Domain Event catalog.
- **Forbidden Coupling:** A module may never depend on another module's internal Domain entities, database structures, or private implementation details. Two modules independently reimplementing the same business rule (Principle 18, Composition over Duplication) is treated as a boundary design defect, not a style issue.

## 9. Technology Decisions

Each decision below is stated at the category/technology-family level, sufficient for architecture, without implementation detail. Decisions marked **(High Reversal Cost)** are flagged in Future ADR References as requiring their own dedicated ADR before implementation begins, consistent with `PROJECT_RULES.md` §4 (ADRs reserved for decisions expensive to reverse) — this document states them as the current direction, not yet as Locked, irreversible commitments.

- **Frontend — (High Reversal Cost):** A modern component-based web framework with strong RTL/i18n ecosystem support and mobile-first responsive capability. *Reason:* aligns with Mobile First (Principle 9) and Bilingual by Design (`ADR-0005`) without requiring a native app for V1 (`PRODUCT_REQUIREMENTS.md` §5). *Alternatives Considered:* a server-rendered classic web framework (less suited to the highly interactive Operations Center and live tracking views); a framework with weaker RTL tooling (would push more custom RTL work onto the Design System). *Trade-offs:* component-based frameworks carry more client-side complexity than server-rendered alternatives, accepted because interactivity (live tracking, real-time Operations Center) outweighs that cost here.
- **Backend — (High Reversal Cost):** A single primary backend language/runtime for the Modular Monolith, chosen for strong async I/O support (relevant to Notifications, Tracking) and ecosystem maturity for building a Clean Architecture/DDD-structured application. *Reason:* consistency with Modular Monolith (one deployable, one dominant runtime) and Principle 26 (avoiding the cost of running multiple runtimes at this stage). *Alternatives Considered:* a statically-typed enterprise-oriented language/runtime (heavier operational footprint at current scale); a dynamically-typed scripting language without strong typing (conflicts with Principle 16, Explicit over Implicit, at scale). *Trade-offs:* a single dominant runtime constrains some future flexibility (e.g. a module wanting a different runtime for AI-specific workloads) — mitigated by the AI Layer being architecturally isolated enough (§5) to use a different runtime specifically for AI workloads without violating the Modular Monolith principle for the business modules.
- **Database — (High Reversal Cost):** A relational database as the primary persistence technology. *Reason:* BARQ's domain has strong consistency requirements (Wallet ledger integrity, Booking/Price fixation, Commission calculation) that relational transactions serve well; supports the scalable localization strategy required by `ADR-0005` (structured multi-language storage) better than a schemaless default would guarantee. *Alternatives Considered:* a document-oriented NoSQL database (weaker transactional guarantees for financial data, a poor fit for Wallet's immutability/ledger invariants). *Trade-offs:* relational schemas require more upfront modeling discipline than a schemaless store — accepted, and in fact desired, given `DATABASE_DESIGN.md`'s job is exactly that discipline.
- **ORM:** A type-safe data access layer/ORM matching the backend language, prioritizing migration tooling and compile-time safety. *Reason:* reduces a class of runtime errors and keeps the Persistence Layer boundary (§4) clean. *Alternatives Considered:* raw SQL throughout (more control, more duplication risk, conflicts with Principle 18). *Trade-offs:* ORM abstraction can obscure query performance if misused — mitigated by treating performance-critical paths (§10) as candidates for deliberate, reviewed exceptions.
- **Authentication:** A custom OTP-based authentication flow (per `DOMAIN_MODEL.md` Identity context) built on top of a managed SMS/OTP delivery provider rather than a fully custom telecom integration. *Reason:* Oman/GCC phone-based UX is central enough to BARQ's identity (`PROJECT_MANIFEST.md` Customer Promise §9) to own the flow itself, while a managed delivery provider avoids the Cost-Aware-violating expense of building telecom infrastructure from scratch. *Alternatives Considered:* a third-party full auth-as-a-service platform (faster initially, but a poor fit for the Staff-Assisted Booking exception already documented in `DOMAIN_MODEL.md`'s `User` invariants, which is a genuinely custom flow). *Trade-offs:* more to build/maintain than a full auth-as-a-service, accepted because Staff-Assisted Booking isn't a standard auth pattern any vendor supports out of the box.
- **Storage:** Object storage for generated files (Invoice/Contract PDFs, any future media). *Reason:* scales without rework as volume grows, at low cost even at small scale (satisfies both Scalability and Cost-Aware principles simultaneously — no tension here). *Alternatives Considered:* local filesystem storage (cheaper only trivially, and doesn't scale or survive infrastructure changes gracefully). *Trade-offs:* negligible at BARQ's stage; object storage is close to a strictly dominant choice here.
- **PDF:** Server-side PDF generation within the Invoicing/Contracts modules' Infrastructure Layer. *Reason:* keeps bilingual formatting (`ADR-0005`) and legal numbering requirements (`DOMAIN_MODEL.md` Invoice invariants) under direct control rather than a third-party template service's constraints. *Alternatives Considered:* a third-party PDF-generation API. *Trade-offs:* more implementation effort now, avoided ongoing per-document third-party cost and formatting constraints later — judged worth it given Invoices/Contracts are permanent legal artifacts.
- **Maps:** A third-party maps/geolocation provider with strong GCC regional coverage, accessed exclusively through the Integration Layer. *Reason:* live tracking and routing (Tracking module) need reliable regional map data that building in-house would not be Cost-Aware to attempt. *Alternatives Considered:* an open-data mapping alternative (weaker regional accuracy risk in Oman/GCC specifically). *Trade-offs:* ongoing third-party cost and dependency, mitigated by Integration Layer isolation (§4, §13) so a future provider switch doesn't ripple into the Tracking module's domain logic.
- **WhatsApp:** WhatsApp Business Platform access via a Business Solution Provider, accessed through the Integration Layer, as the primary Notifications channel. *Reason:* WhatsApp adoption in Oman/GCC makes it the highest-reach channel for the primary Notifications use case. *Alternatives Considered:* SMS-only (lower engagement, no rich bilingual template support). *Trade-offs:* template approval process overhead (already flagged in earlier planning) and a hard dependency requiring the fallback channel already mandated by Principle 22.
- **AI:** Access to large language model capability via a managed API, orchestrated through the AI Layer (§4, §5), rather than self-hosting models at this stage. *Reason:* Cost-Aware Architecture (Principle 26) — self-hosting model infrastructure is a significant, premature infrastructure investment for BARQ's current stage; a managed API gets AI Roles (`AI_STRATEGY.md` §3) to production faster and cheaper. *Alternatives Considered:* self-hosted open models (more control and data residency guarantees, but materially higher infrastructure cost and operational burden at V1 scale). *Trade-offs:* dependency on an external AI provider and its own reliability/terms — mitigated by the AI Layer's isolation (§4) and the Knowledge Sources restriction (`AI_STRATEGY.md` §5) keeping the provider swappable without a domain-level rewrite.
- **Hosting — (High Reversal Cost):** A managed cloud hosting platform with container-based deployment for the Modular Monolith, rather than self-managed infrastructure or a fully serverless decomposition. *Reason:* matches the Modular Monolith's single-deployable shape and minimizes early operational overhead (Cost-Aware), while remaining compatible with later horizontal scaling (§11) and multi-region deployment (§14) without a platform migration. *Alternatives Considered:* self-managed virtual machines (more control, materially more ops burden at this stage); a fully serverless/function-based architecture (a poor fit for a Modular Monolith's shape, and premature decomposition per Principle 26). *Trade-offs:* somewhat less infrastructure control than self-managed hosting, accepted for the reduction in operational burden it buys at BARQ's current stage.
- **CI/CD:** A managed CI/CD pipeline integrated with the Git workflow already defined in `PROJECT_RULES.md` §11–§13. *Reason:* enforces the branch/review discipline already established as policy, automatically, rather than relying on manual compliance. *Alternatives Considered:* self-hosted CI infrastructure (more control, more maintenance burden, not justified at this stage). *Trade-offs:* negligible at BARQ's current scale.
- **Monitoring:** A managed observability/APM platform, satisfying Principle 20 (Observability by Design) without building custom tooling. *Reason:* Cost-Aware — managed observability tooling at BARQ's scale is inexpensive relative to the cost of flying blind in production (§13). *Alternatives Considered:* a self-hosted observability stack (more control, meaningfully more setup/maintenance burden). *Trade-offs:* accepted vendor dependency for observability data, mitigated by keeping instrumentation code vendor-agnostic where reasonably possible.
- **Logging:** A centralized structured logging solution, explicitly preserving the Activity Log/Audit Log distinction (§6) rather than a single undifferentiated stream. *Reason:* Audit Log requirements (`GLOSSARY.md` term 27) need long-retention, tamper-evident handling distinct from routine Activity Log volume. *Alternatives Considered:* a single unified log stream (simpler, but would blur a distinction this project has repeatedly treated as structurally important). *Trade-offs:* marginally more setup complexity, accepted to preserve a distinction this project has consistently protected.
- **Testing:** Automated testing frameworks matching the chosen backend/frontend technologies, covering unit, integration, and end-to-end levels, per `PROJECT_RULES.md` §15. *Reason:* the financial and identity domains (Wallet, Booking, Pricing, Authentication) carry the project's highest correctness risk and cannot rely on manual testing alone. *Alternatives Considered:* manual QA only for V1 (rejected — inconsistent with `PROJECT_RULES.md` §15's binding minimum). *Trade-offs:* upfront test-writing investment, accepted as non-negotiable for the risk level involved.

## 10. Performance Strategy

- **Caching:** Applied at the Infrastructure Layer for read-heavy, slow-changing data (e.g. Service/Experience listings); never for data with a live-correctness requirement (Wallet balance, Availability slot state) — see §6.
- **Database Optimization:** Indexing and query design driven by the access patterns `DATABASE_DESIGN.md` will define around the entities in `DOMAIN_MODEL.md` — not detailed further here, per Out of Scope.
- **Pagination:** Applied to all list-returning Application Layer interfaces (Bookings, Providers, Reviews) as a default, not an afterthought added when a list "gets big."
- **Lazy Loading:** Applied at the Presentation Layer for non-critical content, keeping the mobile-first critical path (Principle 9) fast.
- **Queue Processing:** Used for Background Jobs (§7) — Invoice/Contract PDF generation, Notification dispatch — so these never block a user-facing request/response cycle.
- **Image Optimization:** Applied to any Provider/Service/Experience imagery at the Infrastructure Layer boundary, respecting mobile-first bandwidth constraints (`ARCHITECTURE_PRINCIPLES.md` Principle 9's practical implications).
- **CDN:** Used for static assets and cached imagery, reducing latency for GCC-region users specifically.
- **Concurrency:** Booking confirmation against a shared Availability slot (`DOMAIN_MODEL.md` Booking/Availability invariant) requires explicit concurrency control at the Domain/Application boundary — two simultaneous confirmation attempts against the same slot must not both succeed; specific locking/transaction mechanics are an implementation decision, not detailed further here.

## 11. Scalability Strategy

- **Current:** Single deployable Modular Monolith, single market/tenant (Salalah), sized for V1 scope (`PRODUCT_REQUIREMENTS.md` §5).
- **Future:** Horizontal scaling of the monolith itself (multiple instances behind a load balancer) as the first scaling lever, before any module extraction — the cheaper, simpler option per Cost-Aware Architecture, exhausted before reaching for more complex options.
- **Extraction Strategy:** Per §5's per-module "Future Extraction Potential" — Notifications, Tracking, and AI are the highest-potential early extraction candidates given their distinct load profiles; extraction happens module-by-module, only when a specific module's scaling needs genuinely diverge from the rest of the platform's, never as a wholesale architecture change.
- **Horizontal Scaling:** The Modular Monolith is designed to run as multiple stateless instances from the start (no in-process session state that would prevent this), so this lever is available immediately when needed, not something requiring a redesign later.
- **Tenant Isolation:** Full mechanics owned by future `MULTI_TENANCY_AND_SCALABILITY.md` — this document establishes only that the Domain Layer's entities are designed compatibly with future tenant partitioning (per `DOMAIN_MODEL.md`'s `Tenant` concept in `GLOSSARY.md` term 10), not the specific isolation mechanism.

## 12. Security Architecture

- **Authentication:** Per §9 — OTP-based, Identity module.
- **Authorization:** Enforced at Application Layer boundaries per §6/§8 — never left to the Domain Layer or, worse, the Presentation Layer alone.
- **Encryption:** Data in transit and at rest, particularly for Identity, Payments, and Wallet modules — full policy owned by `SECURITY.md`.
- **Secrets:** Never committed to any repository, per `PROJECT_RULES.md` §16 — architecturally, secrets are injected via the hosting platform's configuration mechanism (§9), never hardcoded.
- **Audit Logs:** Per §6 — immutable, distinct from Activity Logs, covering every Staff/Admin/AI action with consequence.
- **Input Validation:** Enforced at Application Layer boundaries per §6, before any Domain Layer logic executes.
- **Rate Limiting:** Applied at the Presentation/Integration Layer boundary, particularly for OTP request endpoints (a common abuse target) and AI Layer interactions.
- **AI Safety:** Enforced architecturally, not just procedurally — the AI Layer's access to other modules is scoped through the same Application Layer authorization every other actor goes through (§6), meaning `AI_STRATEGY.md` §4's boundaries are a permission-system fact, not merely a written policy an AI Agent is trusted to self-observe.

## 13. Failure Strategy

- **Graceful Degradation:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 22 — every Integration Layer dependency (WhatsApp, Maps, Payment Gateway, AI provider) has a defined degraded behavior, not just a happy path.
- **Retries:** Applied to transient external-integration failures at the Integration Layer, with bounded retry counts — infinite retry loops are treated as a defect, not a resilience feature.
- **Fallbacks:** Notifications fall back to an alternate channel on WhatsApp failure (§9); AI Agent roles fall back to human escalation on low confidence or insufficient knowledge (`AI_STRATEGY.md` §8).
- **Recovery:** Failed Background Jobs (§7, §10) are retried or surfaced for manual intervention — never silently dropped, particularly for anything touching Invoicing or Payments.
- **Circuit Breaker (future):** Not part of V1's minimum architecture, but the Integration Layer's isolation (§4) is designed so a circuit breaker pattern can be added per-integration later without touching Domain Layer code — flagged as a future enhancement, not a current gap that blocks launch.

## 14. Deployment View

- **Development:** Local/isolated environment per developer, mirroring the Modular Monolith's module structure.
- **Staging:** A production-like environment for pre-release validation, using the same hosting platform (§9) configuration pattern as Production, differing only in data and scale.
- **Production:** The live Salalah-launch environment, single-tenant for V1 (§11).
- **Future Multi-Region:** Not part of V1; the Tenant concept (§11) and the hosting platform choice (§9) are both selected partly because they don't preclude multi-region deployment later — this document flags the compatibility, not a committed multi-region plan.

## 15. Architecture Decision Matrix

**Why this architecture was chosen:** A Modular Monolith with strict Clean Architecture/DDD internal boundaries gives BARQ the deployment simplicity and cost profile it needs today (Cost-Aware Architecture, Principle 26) while preserving a genuine, non-theoretical path to extracting specific modules later (§5, §11) — because the internal boundaries already exist and are already enforced, extraction becomes a deployment change, not a redesign.

**Why other architectures were rejected:**
- *Full Microservices at launch:* Rejected per §3 — solves scaling problems BARQ doesn't have yet, at a cost it shouldn't pay yet.
- *Undifferentiated Monolith (no internal module boundaries):* Rejected — would violate DDD/Clean Architecture (Principles 4–5) and make future extraction, or even confident reasoning about the system, effectively impossible without a rewrite.
- *Serverless/function-based decomposition:* Rejected as a poor structural fit for a domain this stateful and transaction-heavy (Booking, Wallet) at this stage, and premature per Principle 26.

## 16. Future Evolution

Over the next decade, BARQ's architecture is expected to evolve from a single-tenant Modular Monolith into a multi-tenant platform spanning the GCC (per `BUSINESS_MODEL.md` §12, and subject to the Vision-wording tension already flagged in that document's Open Questions), with the highest-load modules identified in §5 (Notifications, Tracking, AI, and potentially Wallet and Provider) extracted into independently scaled services as real demand — not speculation — justifies each one individually. The AI Layer is expected to grow in scope (`AI_STRATEGY.md` §10's roadmap) without ever being granted authority beyond `AI_STRATEGY.md` §4's boundaries, which this document treats as permanent architectural constraints, not launch-stage caution to be relaxed later. None of this evolution changes the Domain Layer's shape (`DOMAIN_MODEL.md`) unless the business itself genuinely changes — architecture evolves to serve the domain at scale; it does not get to redefine the domain to suit itself.

---

## Related Documents
- `PROJECT_MANIFEST.md` — Engineering Philosophy §6, Design Philosophy §8
- `PROJECT_RULES.md` — §11–§16 (Git/CI/CD/Testing/Security process this architecture assumes)
- `ARCHITECTURE_PRINCIPLES.md` — all 26 principles, the direct source of every architectural goal and boundary in this document
- `DOMAIN_MODEL.md` — the 15 Bounded Contexts this document's §5 maps to technical modules, unchanged
- `PRODUCT_REQUIREMENTS.md` — §5/§7, V1 module scope this architecture must support
- `BUSINESS_MODEL.md` — §12, the scalability trajectory this document's §11/§16 are designed against
- `AI_STRATEGY.md` — §3–§4, the AI Layer's roles and absolute boundaries
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md` — the two prior architectural decisions this document builds directly on top of
- `DATABASE_DESIGN.md`, `SECURITY.md` — own detail this document intentionally leaves at the architecture level only
- `API_STANDARDS.md`, `MULTI_TENANCY_AND_SCALABILITY.md`, `OBSERVABILITY.md`, `INTEGRATIONS.md`, `EVENTS.md` *(not yet written)* — each will own detail this document intentionally leaves at the architecture level only

## Open Questions
1. §5 flags a structural mismatch between this request's module list and `DOMAIN_MODEL.md`'s Bounded Contexts — "Support" was requested as a distinct module but has no corresponding Bounded Context. This document resolved it by folding Support into Operations, consistent with `DOMAIN_MODEL.md`. Confirm whether `DOMAIN_MODEL.md` should eventually split Support into its own Bounded Context instead (already flagged as that document's own Open Question #2) — if so, this document's module architecture would need a corresponding update via ADR, not a silent edit.
2. §9's technology choices are stated at the category level without naming specific vendors/products. Should specific product selection happen in this document's next revision, or in dedicated per-decision ADRs (as flagged for the High Reversal Cost items)? Proposed: dedicated ADRs for the High Reversal Cost items specifically (Frontend, Backend, Database, Hosting), given `PROJECT_RULES.md` §4 reserves ADRs for expensive-to-reverse decisions.
3. §11's tenant isolation mechanism (schema-per-tenant, row-level partitioning, or database-per-tenant) is deliberately left to `MULTI_TENANCY_AND_SCALABILITY.md` — flagging here so it isn't assumed decided by omission.

## Future ADR References
- Frontend, Backend, Database, and Hosting technology selections (§9, marked High Reversal Cost) each require a dedicated ADR naming the specific technology before implementation begins — this document establishes the category-level direction, not the final binding choice.
- Any future decision to extract a module (§5, §11) into an independent service requires an ADR, consistent with how `ADR-0002` treated the original monolith-vs-microservices choice — extraction is the same class of decision in reverse, not a routine deployment change.
- Any resolution of Open Question #1 (Support as its own Bounded Context) that changes `DOMAIN_MODEL.md` requires an ADR affecting both that document and this one's §5.
