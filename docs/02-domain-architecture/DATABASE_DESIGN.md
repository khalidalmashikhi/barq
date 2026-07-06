# BARQ Database Design

- **Purpose:** Define BARQ's complete data architecture — how persistent data is organized, owned, protected, versioned, audited, and scaled. This is the authoritative source for data architecture; it is not SQL, not a Prisma schema, not migrations, not API contracts, not implementation.
- **Scope:** Data philosophy, Bounded Context data ownership, entity-level data attributes, relationship strategy, localization strategy, multi-tenancy strategy, audit/activity logging, versioning, security, performance, AI data strategy, backup/DR, data lifecycle, data quality rules, naming standards, anti-patterns, and future evolution.
- **Out of Scope:** SQL, Prisma models, migrations, API contracts, UI, any implementation. Specific retention durations pending legal input (owned by future `COMPLIANCE_AND_LEGAL.md`).
- **Dependencies:** `ADR-0006-database-baseline.md` (PostgreSQL, Prisma, UUID v7, UTC time, Decimal money, Currency pair, Object Storage for files, Audit/Activity Log separation, cross-module access rule — all treated here as binding requirements, not repeated), `DOMAIN_MODEL.md` (every Bounded Context and entity below is that document's, referenced not redefined), `SYSTEM_ARCHITECTURE.md` (§4–§8, layering and module boundaries this document's data ownership rules enforce at the persistence layer), `ARCHITECTURE_PRINCIPLES.md`, `ADR-0005-bilingual-architecture.md`, `AI_STRATEGY.md` (§5–§6, for §13 below), `PROJECT_RULES.md` (§16, Security minimums).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## 1. Executive Summary

BARQ's data architecture mirrors its domain architecture: each of the 15 Bounded Contexts in `DOMAIN_MODEL.md` owns its own data, exposed to other contexts only through published interfaces and events (`SYSTEM_ARCHITECTURE.md` §6–§8) — never through direct cross-module table access, per `ADR-0006`. On top of that ownership model, this document layers the conventions every entity must follow regardless of which context owns it: UUID v7 keys, UTC timestamps, Decimal-only money paired with an explicit currency, files stored as Object Storage with metadata-only rows, and a strict, permanent separation between Audit Log and Activity Log. Bilingual content (`ADR-0005`) is a first-class data concern, not a translation layer bolted onto an English-shaped schema. Nothing in this document is SQL — it is the set of decisions `DATABASE_DESIGN.md`'s eventual schema (a future, lower-level artifact, still not written even after this document) must satisfy.

## 2. Data Philosophy

- **Single Source of Truth:** Every fact is stored in exactly one owning table, in exactly one owning Bounded Context's schema area — the data-layer expression of `ARCHITECTURE_PRINCIPLES.md` Principle 2.
- **Domain Ownership:** Data ownership follows `DOMAIN_MODEL.md`'s Bounded Context ownership exactly (§4 below) — the database schema is organized around the business, not the other way around.
- **Data Integrity:** Enforced through relational constraints, transactions, and the Decimal-only money rule (`ADR-0006`) — correctness is a database-level guarantee, not an application-level hope.
- **Auditability:** Every entity flagged as Audit-relevant in `DOMAIN_MODEL.md` (Provider approval, Admin actions, Staff-assisted actions, AI Agent high-risk actions) has a corresponding, immutable Audit Log trail, distinct from Activity Log (§9).
- **Immutability:** Applied wherever `DOMAIN_MODEL.md` already establishes it — Wallet Transaction, Route, Rating are never edited or deleted after creation; corrections are new records, never in-place changes.
- **Privacy by Design:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 12 — PII fields are explicitly classified (§11), not implicitly scattered across tables without a data-classification decision.
- **Security by Design:** Per Principle 11 — encryption, secrets handling, and least-privilege access (§11) are schema-level decisions, not retrofitted.
- **Cost-Aware Storage:** Per Principle 26 — high-volume, low-durability-need data (e.g. raw Route location pings) is treated differently from permanent financial/legal records (§12, §15); not everything is stored forever by default.
- **AI Readiness:** Per Principle 8 and `AI_STRATEGY.md` — AI-relevant data (§13) is structured so AI Agents read live business data through the same access rules as any other consumer, never through a shadow copy that could drift.
- **Bilingual by Design:** Per `ADR-0005` — localized content has an explicit, structured storage strategy (§7), not an assumption that "we'll add Arabic columns later."
- **Future Scalability:** Per Principle 21 — schema and key design (UUID v7, tenant-compatible entity design) do not preclude the multi-tenant, multi-region future already described in `BUSINESS_MODEL.md` §12, even though V1 is single-tenant.

## 3. Database Baseline (Approved)

Fully recorded in `ADR-0006-database-baseline.md` — referenced here, not restated, per Single Source of Truth. Summary for orientation only: PostgreSQL, Prisma ORM, UUID v7 primary keys, UTC-stored timestamps, Decimal-only money with explicit Currency, Object Storage for files (metadata only in the database), a strict Audit Log/Activity Log separation, and no direct cross-module table access without recorded justification. Every section below assumes these as fixed requirements.

## 4. Bounded Context Ownership

For each of `DOMAIN_MODEL.md`'s 15 Bounded Contexts: **Owns** (its own data, unchanged from `DOMAIN_MODEL.md` §1), **Consumes** (what it reads from other contexts, always via published interface/event, never direct table access, per `ADR-0006`), **Publishes** (the events other contexts may subscribe to, per `DOMAIN_MODEL.md` §3 / `SYSTEM_ARCHITECTURE.md` §5), **Shared Data Rules** (how a reference to another context's data is represented).

| Bounded Context | Owns (data) | Consumes (via interface/event only) | Publishes | Shared Data Rules |
|---|---|---|---|---|
| Identity | `User` | — | User Registered, User Verified | Every other context stores only a `User` ID reference, never a copy of identity data |
| Customer | `Customer` | User Registered | (lifecycle events, per `EVENTS.md`) | Referenced by ID from Booking, Reviews |
| Provider | `Provider`, `Driver`, `Guide`, `Vehicle`, `Asset`, `Service`, `Experience`, `Availability` | Provider Applied (from Contracts flow), Admin Configuration Changed | Provider Applied/Approved/Suspended, Driver/Guide/Vehicle Registered | Referenced by ID from Booking, Pricing; Service/Experience Price is owned by Pricing, not duplicated here |
| Booking | `Booking` | Provider Approved/Suspended, Price Set, Commission Calculated | Booking Created/Confirmed/Cancelled/Disputed | Referenced by ID from Tracking, Payments, Invoicing, Reviews |
| Pricing | `Price`, `Commission` | Provider Approved (tier assignment trigger) | Price Set, Commission Calculated, Commission Tier Changed | Booking stores a Price/Commission *snapshot* (fixed values), not a live reference — per `DOMAIN_MODEL.md`'s fixed-at-confirmation invariant, this is intentional duplication of a value, not of ownership |
| Payments | `Payment` | Booking Confirmed | Payment Received, Payment Failed, Refund Issued | Referenced by ID from Wallet, Invoicing |
| Wallet | `Wallet`, `Wallet Transaction` | Payment Received, Commission Calculated, Refund Issued | Wallet Transaction Recorded, Payout Processed | Never exposes raw transaction internals directly to other contexts; other contexts subscribe to its published events only |
| Contracts | `Contract` | Provider Applied | Contract Sent, Contract Signed | Referenced by ID from Provider (Approval gate check) |
| Invoicing | `Invoice` | Booking Confirmed/Completed, Payment Received | Invoice Generated | Referenced by ID from Booking, Wallet |
| Notifications | `Notification` | (subscribes broadly — nearly every event in `DOMAIN_MODEL.md` §3) | Notification Sent, Notification Delivery Failed | Never owns or duplicates the business data it notifies about — only a reference plus rendered bilingual content |
| Tracking | `Journey`, `Route` | Booking Confirmed | Journey Started/Completed/Interrupted | Referenced by ID from Booking, Operations |
| Reviews | `Review`, `Rating` | Booking Completed | Review Submitted | Referenced by ID from Booking, Customer, Provider |
| Operations | `Support Ticket` | Booking Disputed, Journey Interrupted (and broadly, for real-time oversight) | (Support Ticket lifecycle events, per `EVENTS.md`) | Never owns Booking/Journey data directly — observes via reference and subscription only, per `DOMAIN_MODEL.md`'s "Does Not Own" for this context |
| Administration | `Staff`, `Admin` | Provider Applied | Admin Configuration Changed | Referenced by ID wherever an action is attributed (Audit Log) |
| AI | `AI Agent` | (per-role, scoped, per `AI_STRATEGY.md` §3 — read-only via published interfaces) | AI Recommendation Generated, AI Action Escalated for Human Review | Never owns or caches business data from another context (§13) |

## 5. Entity Ownership

Purpose and Lifecycle for every entity are fully owned by `DOMAIN_MODEL.md` and not repeated here, per Single Source of Truth — this table defines only the data-architecture-specific attributes not already covered there.

| Entity | Owner (Context) | Audit Requirement | Localization Requirement | Soft Delete Policy | Versioning Requirement | Retention Policy |
|---|---|---|---|---|---|---|
| User | Identity | Yes (role/credential changes) | No | Soft delete (Deactivated) | Optimistic locking | Compliance-driven minimum (owned by `COMPLIANCE_AND_LEGAL.md`) |
| Customer | Customer | Partial (Activity Log for profile changes) | No (language *preference* stored, not localized content) | Soft delete | Optimistic locking | Compliance-driven minimum |
| Provider | Provider | Yes (approval/suspension) | Yes (business name/description) | Soft delete (Suspended is a state, not deletion) | Optimistic locking | Retained while relationship active; post-termination policy TBD (§20) |
| Driver | Provider | Yes (registration/verification) | Partial (display name) | Soft delete | Optimistic locking | Tied to owning Provider's retention |
| Guide | Provider | Yes (registration/verification) | Partial (display name) | Soft delete | Optimistic locking | Tied to owning Provider's retention |
| Vehicle | Provider | Yes (registration/verification) | Partial (descriptive fields) | Soft delete | Optimistic locking | Tied to owning Provider's retention |
| Asset | Provider | Yes (registration/verification) | Partial (descriptive fields) | Soft delete | Optimistic locking | Tied to owning Provider's retention |
| Service | Provider | Partial (Activity Log for publish/pause) | Yes (name/description — core bilingual content) | Soft delete (Archived; never hard-deleted while any Booking references it) | Optimistic locking | Retained for as long as any Booking references it |
| Experience | Provider | Partial (Activity Log) | Yes (specialization of Service) | Same as Service | Optimistic locking | Same as Service |
| Booking | Booking | Yes (all state transitions, cancellations) | No (references a localized Service snapshot, doesn't itself hold translated content) | Never hard-deleted (financial/legal record; Cancelled is a state) | Optimistic locking mandatory (confirmation-time concurrency, per `SYSTEM_ARCHITECTURE.md` §10) | Long retention (financial/legal record) |
| Journey | Tracking | Partial (start/complete Activity Logged; interruption may be Audit-relevant) | No | Never deleted once Completed | Optimistic locking during active state | Tied to owning Booking's retention |
| Route | Tracking | No | No | Never deleted once finalized (immutable per `DOMAIN_MODEL.md`) | Append-only; no versioning after finalization | Retention duration for raw location pings is an Open Decision (§20) — cost vs. historical-record value not yet resolved |
| Availability | Provider | No (Activity Log only) | No | Not soft-deleted in the traditional sense — slots are consumed/replaced | Optimistic locking mandatory (booking-race scenario) | Short-term; prunable/archivable after expiry (Cost-Aware) |
| Price | Pricing | Yes (affects Commission, hence money) | No (amount + currency, language-neutral) | Never hard-deleted; superseded, not deleted | New version on every change (append, never update-in-place) | Long retention (tied to historical Bookings) |
| Commission | Pricing | Yes (tier changes are Admin actions) | No | Never hard-deleted; superseded | New version on every tier change | Long retention (financial/compliance record) |
| Wallet | Wallet | Yes | No | Never deleted; zero-balanced only, per `DOMAIN_MODEL.md` invariant | Optimistic locking on concurrent transaction writes | Permanent, plus compliance tail after relationship ends |
| Wallet Transaction | Wallet | Yes (this is itself the audit-grade ledger) | No | Never deleted or edited; corrections are new offsetting entries | None — immutable by design, never versioned because never changed | Long/permanent retention (financial/compliance record) |
| Payment | Payments | Yes | No | Never hard-deleted | Status-transition history tracked; optimistic locking | Long retention (financial/compliance record) |
| Invoice | Invoicing | Yes | Yes (bilingual legal document content) | Never deleted or edited; corrected via Credit Note, per `DOMAIN_MODEL.md` invariant | Immutable once issued; no in-place versioning | Long/permanent retention (exact legal duration owned by `COMPLIANCE_AND_LEGAL.md`) |
| Contract | Contracts | Yes | Yes (bilingual legal terms) | Never deleted or edited; superseded by a new Contract | Immutable once Signed | Long/permanent retention (legal record) |
| Notification | Notifications | Partial (delivery logs may matter as dispute evidence) | Yes (bilingual content, per `ADR-0005`) | Soft delete/prunable after retention window | None | Short-to-medium retention; exact window is an Open Decision (§20) |
| Review | Reviews | No (moderation actions, if any, may become Audit-relevant) | No structural requirement beyond storing submitted text as-is | Soft delete, pending resolution of `DOMAIN_MODEL.md`'s open moderation-policy question | Immutable per `DOMAIN_MODEL.md` invariant — a changed opinion is a new Review, not an edit | Long retention (public trust signal, part of Provider history) |
| Rating | Reviews | No | No (numeric) | Tied to its Review — removed together, if ever | Immutable per `DOMAIN_MODEL.md` invariant | Tied to its Review's retention |
| Support Ticket | Operations | Partial (financial resolutions must be Audit-linked, per `DOMAIN_MODEL.md` invariant) | No structural requirement | Soft delete/closeable; never hard-deleted if linked to a financial resolution | Status history tracked | Medium-to-long, longer specifically when Dispute/refund-linked |
| Staff | Administration | Yes | No | Soft delete (Deactivated) | Optimistic locking | Retained per compliance/employment-record requirements |
| Admin | Administration | Yes | No | Soft delete (Deactivated) | Optimistic locking | Retained per compliance requirements |
| AI Agent | AI | Yes (definition/deployment changes) | No (the entity's definition is language-neutral; bilingual behavior is a capability of the agent, not localized data on the record) | Soft delete (Retired, never deleted, per `AI_STRATEGY.md` §7's Prompt Retirement pattern applied here) | Versioned definition, mirroring `AI_STRATEGY.md` §7's Prompt Versioning | Long retention (governance/audit trail of what agents existed and did) |

## 6. Relationship Strategy

- **One-to-One:** Used sparingly — e.g. `Review`↔`Rating` (a Rating never exists without exactly one owning Review, per `DOMAIN_MODEL.md`).
- **One-to-Many:** The dominant pattern — `Provider`→many `Driver`/`Guide`/`Vehicle`/`Asset`/`Service`; `Wallet`→many `Wallet Transaction`; `Booking`→one `Journey`→many `Route` recordings.
- **Many-to-Many:** Used only where the domain genuinely requires it — none identified as a hard requirement in `DOMAIN_MODEL.md`'s current entity set; flagged for confirmation once a real case arises rather than introduced speculatively (Convention over Configuration, `ARCHITECTURE_PRINCIPLES.md` Principle 19).
- **Composition:** `Route` recordings are composed within a `Journey`'s lifecycle — they have no independent existence or meaning outside their owning `Journey`.
- **Aggregation:** A `Provider`'s `Driver`/`Guide`/`Vehicle`/`Asset` records are aggregated under it but retain independent identity and lifecycle (a `Driver` can be Deactivated without the `Provider` being affected).
- **Inheritance (specialization):** `Vehicle` specializes `Asset`; `Experience` specializes `Service` — modeled as the specialization pattern already established in `DOMAIN_MODEL.md`, not database table inheritance specifically (that mechanism is a future `DATABASE_DESIGN.md`-adjacent implementation decision, not decided here).
- **Entity References:** Within the same Bounded Context, direct relational references (foreign keys) are used freely.
- **Cross-Context References:** Always by ID reference only, never a join across another context's tables directly, per `ADR-0006`'s cross-module access rule — a context needing more than an ID must consume a published event or interface, per §4's Shared Data Rules.

## 7. Localization Strategy

- **Arabic / English:** Every entity marked "Yes" in §5's Localization Requirement column stores both languages as structured, queryable content — not a single "translated blob" — consistent with `ADR-0005`'s requirement that Arabic and English carry full parity.
- **Future Languages:** The localization structure must not hard-code a two-language assumption (`ADR-0005` requirement 9) — the specific mechanism (translation table vs. locale-keyed structure) is deferred to implementation-level schema design, not decided in this document, but the *requirement* that it support N languages without a schema change is binding now.
- **Translation Ownership:** The owning Bounded Context of an entity also owns its translations — translations are never a separate, cross-cutting "localization service" that would violate Domain Ownership (§2).
- **Fallback Rules:** If content is missing in the requested language, a defined fallback language is shown rather than blank content. **Resolved by `LOCALIZATION.md` §3**, the authoritative source for this decision: requested language → Arabic → English → never blank.
- **Localized Content:** Provider/Service/Experience names and descriptions, Invoice/Contract document content, Notification content — anything a human reads as language-bearing text.
- **Non-Localized Content:** Identifiers, monetary amounts (paired with a language-neutral currency code), timestamps, enums/status values, technical fields of any kind — per `PROJECT_RULES.md` §23's confirmed English-only-identifiers rule, applied here to data as well as code.

## 8. Multi-Tenancy Strategy

- **Current Architecture:** V1 is single-tenant (Salalah launch, per `PRODUCT_REQUIREMENTS.md` §5) — no tenant partitioning is active in the data layer yet.
- **Future Evolution:** Per `BUSINESS_MODEL.md` §12 and the `Tenant` concept already defined in `GLOSSARY.md` term 10, expansion to additional markets will require activating a tenant-isolation mechanism.
- **Tenant Isolation:** The specific mechanism (schema-per-tenant, row-level tenant-column partitioning, or database-per-tenant) is **not decided in this document** — this is an intentionally deferred decision, listed in §20, not invented here to appear complete.
- **Shared Resources:** Which entities (if any) would remain global/shared across tenants (e.g. `GLOSSARY.md` terms themselves are not tenant data at all — they're documentation) versus fully partitioned per tenant is likewise deferred to `MULTI_TENANCY_AND_SCALABILITY.md` (not yet written).
- **Country Expansion:** Each new country/market is expected to become a Tenant per the above, but the entity design in §5 has been kept compatible with eventual tenant-scoping (no entity design here assumes global uniqueness in a way that would block adding a tenant dimension later) — compatibility now, activation later.

## 9. Audit & Activity Logging

- **Activity Log:** Routine, expected actions (profile updates, availability changes, booking status views) — operational visibility, shorter retention, per `GLOSSARY.md` term 26.
- **Audit Log:** Security- or compliance-relevant actions (Provider approval/suspension, Commission tier changes, Staff-assisted actions, AI Agent high-risk actions, Admin configuration changes) — immutable, long-retention, legally defensible, per `GLOSSARY.md` term 27.
- **Retention:** Activity Log retention is short-to-medium and cost-driven (Principle 26); Audit Log retention is long, driven by compliance need, not storage cost — the two must never share a retention policy just because it would be simpler to manage one.
- **Immutable Records:** Every Audit Log entry, once written, is never edited or deleted — corrections are new entries referencing the original, mirroring the Wallet Transaction immutability pattern already established.
- **Compliance Considerations:** Exact retention durations and any Oman PDPL-specific requirements are owned by future `COMPLIANCE_AND_LEGAL.md` — this document establishes the structural separation and immutability requirement, not the specific numbers.

## 10. Versioning Strategy

- **Optimistic Locking:** The default concurrency strategy for mutable entities (per §5's Versioning Requirement column) — a version marker prevents two concurrent updates from silently overwriting each other, critical for `Availability` (booking-race scenario) and `Provider`/`Staff`/`Admin` configuration changes.
- **Version Columns:** Applied wherever optimistic locking is required (§5); not applied to immutable entities (`Wallet Transaction`, `Route`, `Rating`), since there is nothing to version when nothing is ever updated.
- **Historical Records:** `Price` and `Commission` use an append-new-version strategy rather than update-in-place, so a `Booking`'s fixed-at-confirmation snapshot (`DOMAIN_MODEL.md` invariant) always has a real historical record to point to, not a value that could be retroactively altered.
- **Migration Strategy:** Schema migration mechanics are a Prisma-level implementation concern, explicitly out of scope for this document.
- **Schema Evolution:** Governed by `PROJECT_RULES.md` §24 (Breaking Change Policy) — any backward-incompatible schema change requires the ADR and migration-path process already established there, referenced not repeated.

## 11. Security Strategy

- **PII:** Phone numbers, names, and any personally identifying fields are explicitly classified as PII at the entity level (§5 implicitly flags which entities carry it — `User`, `Customer`, `Driver`, `Guide`, `Staff`, `Admin` — full formal classification owned by future `SECURITY.md`).
- **Encryption:** Data at rest and in transit, particularly for Identity, Payments, and Wallet data — full policy owned by future `SECURITY.md`; this document establishes that encryption is a schema-level design input, not an afterthought.
- **Secrets:** Never stored in application tables — connection credentials and API keys live in the hosting platform's secret management (per `SYSTEM_ARCHITECTURE.md` §9/§12), never in a database table, ever.
- **Masking:** PII fields are masked in non-production environments and in any logging/observability output — full mechanics owned by `SECURITY.md`.
- **Access Policies:** Least-privilege database access per module/service credential, consistent with the cross-module access rule in `ADR-0006` — a module's database credentials should not even be *capable* of touching another module's tables, not merely conventionally discouraged from doing so.
- **Data Classification:** Every entity should eventually carry an explicit classification (Public, Internal, Confidential, Restricted) — this document establishes the requirement; the full classification exercise is owned by `SECURITY.md`.
- **Least Privilege:** Applied at every level — database roles, application service accounts, and AI Agent data access (§13) all follow the same principle uniformly.

## 12. Performance Strategy

- **Indexes:** Applied to foreign keys, frequently-filtered fields (Booking status, Provider approval status), and any field used in the concurrency-sensitive paths named in §10.
- **Caching:** Per `SYSTEM_ARCHITECTURE.md` §6 — read-heavy, slow-changing data only (Service/Experience listings); never for live-correctness-required data (Wallet balance, Availability state).
- **Pagination:** Default behavior for every list-returning query, per `SYSTEM_ARCHITECTURE.md` §10 — not an afterthought added when a table "gets big."
- **Partitioning:** A candidate future technique for high-volume, time-ordered data (`Route` location pings, `Wallet Transaction` ledger at sufficient scale) — not required for V1's Salalah-launch volume, flagged for future consideration rather than designed in prematurely (Cost-Aware Architecture).
- **Read Optimization:** The Operations Center's real-time view (`SYSTEM_ARCHITECTURE.md` §5) is a strong candidate for a dedicated read-model/projection later, kept as a noted possibility, not a V1 commitment.
- **Write Optimization:** `Wallet Transaction` and `Route` are write-heavy, append-only patterns — schema design should favor efficient inserts over update-optimized structures for these specifically.
- **Archiving:** High-volume, lower-long-term-value data (`Availability` slots long past expiry, raw `Route` pings past a to-be-determined window per §20) are candidates for archiving out of the primary operational tables — exact policy deferred, not invented here.

## 13. AI Data Strategy

- **Approved Knowledge:** Per `AI_STRATEGY.md` §5 — stored as versioned, structured references to actual approved documents, never duplicated as a separate "AI knowledge copy" that could drift from the real source (Single Source of Truth, §2).
- **Conversation State:** Short-term session data (`AI_STRATEGY.md` §6) is stored ephemeral and separate from durable business tables — never comingled with permanent records.
- **Project Memory:** Applies only to Documentation/Developer Assistant roles (`AI_STRATEGY.md` §6) — sourced live from approved documentation, never cached as independent AI-owned data.
- **Business Memory:** Per `AI_STRATEGY.md` §6's State Ownership rule — never stored or cached by the AI Layer at all; always a live read through the owning Bounded Context's published interface, enforced at the data layer by the same cross-module access rule (`ADR-0006`) as any other consumer.
- **Future Vector Store / Future Embeddings:** Explicitly deferred — not decided in this document (§20). If adopted, it would be a new, clearly-scoped store for approved-knowledge retrieval only, never a substitute for live Business Memory reads.
- **PII Protection:** AI data paths follow the exact same PII classification and least-privilege rules as §11 — an AI Agent does not get a data-access exception by virtue of being an AI Agent.
- **Explainable Context:** Wherever feasible, data structures should allow tracing which approved knowledge source(s) fed a specific AI output, supporting `AI_STRATEGY.md` §2's Explainable Decisions principle — full mechanics are an implementation concern, but the traceability *requirement* is stated here.

## 14. Backup & Disaster Recovery

- **Backup Policy:** Regular, automated backups covering all persistent data, with particular attention to financial (`Wallet Transaction`, `Payment`, `Invoice`) and identity (`User`) data given their compliance sensitivity.
- **Recovery Strategy:** Full mechanics owned by future `DEPLOYMENT_AND_INFRASTRUCTURE.md` — this document establishes only that backup/recovery is a first-class data-architecture concern, not an operations afterthought.
- **Recovery Objectives:** Specific RTO/RPO targets are not invented here — deferred to `DEPLOYMENT_AND_INFRASTRUCTURE.md`, once real operational constraints are known.
- **Retention:** Backup retention should meet or exceed the longest applicable data retention policy in §5/§9 — a backup shorter than a record's own retention requirement would defeat the purpose of that retention policy.

## 15. Data Lifecycle

Applied per entity according to §5's Soft Delete Policy and Retention Policy columns — this section states the general states available, not a per-entity repeat:

- **Created** → **Modified** (where mutable) → **Versioned** (where §10 applies) → **Archived** (where §12 applies, for high-volume/lower-value data) → **Deleted** (soft, only where §5 permits — never for financial/legal records, per `ADR-0006`'s anti-pattern list) → **Restored** (from soft-delete, where business rules allow) → **Expired** (for genuinely time-bound data like `Availability` slots).

Financial and legal records (`Wallet Transaction`, `Payment`, `Invoice`, `Contract`) never enter a true "Deleted" state — their lifecycle ends at long-term Archived, never Deleted, consistent with §18's anti-pattern list.

## 16. Data Quality Rules

- **Validation:** Enforced at the Application Layer boundary (`SYSTEM_ARCHITECTURE.md` §6) before data reaches persistence — the database enforces structural/referential integrity as a second, not first, line of defense.
- **Consistency:** Cross-entity consistency (e.g. a `Booking`'s `Price` snapshot matching what was actually charged in its `Payment`) is a business invariant already stated in `DOMAIN_MODEL.md`, enforced here through transactional writes at confirmation time.
- **Uniqueness:** Enforced at the database level for natural uniqueness constraints (e.g. one `User` per verified phone number).
- **Referential Integrity:** Enforced through relational foreign keys within a Bounded Context; cross-context references (§6) are validated at the Application Layer, since they are ID references, not database-enforced foreign keys across module boundaries (consistent with `ADR-0006`'s cross-module access rule).
- **Mandatory Fields:** Every entity's mandatory fields derive from `DOMAIN_MODEL.md`'s Business Invariants (e.g. a `Service` must have a `Price` before Publishing) — this document doesn't invent new mandatory fields beyond what the domain model already requires.
- **Business Invariants:** Fully owned by `DOMAIN_MODEL.md` — this document ensures the data layer is *capable* of enforcing them, it does not restate them.

## 17. Naming Standards

- **Entity Names:** Match `GLOSSARY.md`-canonical, English-only identifiers, per `PROJECT_RULES.md` §23 — no exception for data-layer naming.
- **Identifiers:** UUID v7 per `ADR-0006`, named consistently (e.g. a primary identifier field, not inconsistently named per table).
- **Enums:** English-only values (per §23), representing states already defined in `DOMAIN_MODEL.md`'s lifecycle descriptions (e.g. Booking status values match its stated lifecycle exactly, not an ad hoc reinterpretation).
- **Timestamps:** Named consistently to make UTC storage unambiguous (per `ADR-0006`) — exact naming convention is an implementation detail, but the *requirement* for unambiguous naming is stated here.
- **Localization Fields:** Named consistently to distinguish language variants without ambiguity — exact convention deferred to implementation, structural requirement stated in §7.
- **Audit Fields:** Consistently present on every Audit-required entity (§5) — who, when, what changed — named uniformly across the schema rather than reinvented per module.
- **Money Fields:** Always paired — an amount field and a currency field together, never an amount field alone, per `ADR-0006`.

## 18. Anti-Patterns

Explicitly forbidden, without exception:

- Direct module-to-module table access (violates `ADR-0006` and `ARCHITECTURE_PRINCIPLES.md` Principle 6).
- Duplicate business data across modules (violates Principle 18, Composition over Duplication).
- Float or Double for money, ever (violates `ADR-0006`'s Money Strategy — financial correctness has zero tolerance here).
- Storing local time instead of UTC (violates `ADR-0006`'s Time Strategy).
- Hard delete of financial data (`Wallet Transaction`, `Payment`, `Invoice`) — violates §15's lifecycle rule.
- Hard delete of audit records — violates §9's immutability requirement.
- Business logic inside the ORM (e.g. computed business rules as database triggers or ORM hooks) — violates `ARCHITECTURE_PRINCIPLES.md` Principle 24 (business rules belong to the Domain Layer, not the persistence layer).
- Database-driven business rules (e.g. a database constraint that encodes a Commission calculation) — same violation as above, at the schema level specifically.
- Cross-context coupling through SQL (e.g. a SQL join across two Bounded Contexts' tables) — violates `ADR-0006`'s cross-module access rule even when the ORM makes it technically easy to write.
- Storing files inside PostgreSQL — violates `ADR-0006`'s File Storage decision; Object Storage only, metadata in the database.

## 19. Future Evolution

- **Regional Expansion:** Requires activating the deferred tenant-isolation mechanism (§8, §20) as BARQ moves through `BUSINESS_MODEL.md` §12's staged rollout.
- **Internationalization:** The localization structure (§7) is designed to extend beyond Arabic/English without a schema change, per `ADR-0005` requirement 9 — future languages are a content operation, not a re-architecture.
- **Analytics:** A future analytics/reporting need is expected to read from dedicated projections or a future data warehouse, never by querying operational tables directly at reporting scale — full design deferred to future `KPIS.md`/`METRICS.md`/`REPORTS.md`.
- **Data Warehouse:** Not part of V1; flagged as a plausible future need once analytics requirements (`BUSINESS_MODEL.md` §15, `PRODUCT_REQUIREMENTS.md` §10) mature enough to justify one.
- **AI Knowledge Store:** The Future Vector Store possibility named in §13 — deferred, not decided.
- **Future Read Models:** The Operations Center (§12) and any future Analytics need are the two clearest candidates for dedicated read models, should real-time or reporting performance ever require decoupling reads from the primary operational schema.

## 20. Open Decisions

Intentionally deferred — not invented here:

1. **Tenant isolation mechanism** (schema-per-tenant vs. row-level partitioning vs. database-per-tenant) — deferred to `MULTI_TENANCY_AND_SCALABILITY.md`.
2. **Raw `Route` location-ping retention window** — a genuine Cost-Aware-vs-historical-value tradeoff, not yet quantified.
3. **`Notification` retention window** — short-to-medium is stated as direction, exact duration undecided.
4. **Exact legal retention durations** for financial/legal records (`Invoice`, `Contract`, `Wallet Transaction`) — pending `COMPLIANCE_AND_LEGAL.md`.
5. **`Review`/`Rating` soft-delete/moderation mechanics** — pending resolution of `DOMAIN_MODEL.md`'s own open moderation-policy question.
6. **Whether Many-to-Many relationships will be needed** — none identified as required by the current domain model; revisit if a real case emerges rather than pre-designing for a hypothetical one.
7. **Table-inheritance mechanism** for `Vehicle`/`Asset` and `Experience`/`Service` specializations — a schema-design-level decision appropriately deferred past this document's scope.
8. **Future Vector Store / Embeddings adoption timing** — deferred per §13, not a V1 decision.
9. **Post-relationship-termination retention policy** for `Provider`/`Customer` data — pending `COMPLIANCE_AND_LEGAL.md`.

---

## Related Documents
- `ADR-0006-database-baseline.md` — the technology and convention decisions this entire document builds on
- `PROJECT_MANIFEST.md`, `PROJECT_RULES.md` — foundational philosophy and process (§23 naming, §16 security minimums)
- `ARCHITECTURE_PRINCIPLES.md` — nearly every principle has a data-layer expression somewhere in this document
- `DOMAIN_MODEL.md` — the entities, Bounded Contexts, and invariants this document's ownership and lifecycle rules are built from, never redefined
- `AI_STRATEGY.md` — §5–§6, governing §13 in full
- `BUSINESS_MODEL.md` — §12, the expansion trajectory §8/§19 are designed against
- `PRODUCT_REQUIREMENTS.md` — §5, V1 scope this document's "current architecture" statements (e.g. single-tenant) reflect
- `SYSTEM_ARCHITECTURE.md` — §4–§10, the module/layer boundaries this document enforces at the persistence layer
- `ADR-0005-bilingual-architecture.md` — governs §7 in full
- `COMPLIANCE_AND_LEGAL.md`, `MULTI_TENANCY_AND_SCALABILITY.md`, `SECURITY.md`, `DEPLOYMENT_AND_INFRASTRUCTURE.md`, `EVENTS.md`, `KPIS.md`/`METRICS.md`/`REPORTS.md` *(all not yet written)* — each owns detail this document intentionally defers to it

## Open Questions
1. §5 flags `Review` moderation soft-delete policy as dependent on an unresolved `DOMAIN_MODEL.md` question — should that be resolved there first, with this document updated afterward, or can this document propose a default now? Currently left dependent, not resolved unilaterally.
2. Should Operations' Support Ticket eventually need its own dedicated schema area if `DOMAIN_MODEL.md`'s Open Question #2 (splitting Support into its own Bounded Context) resolves that way? This document's §4/§5 currently assume it stays under Operations — flagged as contingent, not fixed.
3. Is UUID v7's time-ordering property (which reveals approximate creation time) an acceptable trade-off for identity-adjacent entities (`User`) from a privacy standpoint, or should those specifically use a non-time-ordered UUID variant? Flagged for `SECURITY.md`'s eventual PII classification work.

## Future ADR References
- Any resolution of an Open Decision (§20) that becomes a real architectural commitment (e.g. choosing a specific tenant isolation mechanism) requires its own ADR when decided.
- Any future change to `ADR-0006`'s baseline decisions requires an ADR that explicitly supersedes it, per that ADR's own Future ADR Reference.
