# BARQ Prisma Schema Specification

- **Purpose:** Translate BARQ's approved Domain Model into an implementation-ready Prisma schema specification. This is not `schema.prisma` — it is the engineering specification that will later be converted into it. No architectural decisions are introduced, no business rules change, no entities are invented.
- **Scope:** Every entity in `DOMAIN_MODEL.md`, specified at the model level (fields, relations, enums, indexes, constraints, soft-delete, audit) sufficient for direct Prisma schema authoring.
- **Out of Scope:** Actual Prisma syntax, migrations, application code, API contracts, any new business rule or entity.
- **Dependencies:** `DOMAIN_MODEL.md` (the entities and invariants this document implements, verbatim in meaning), `DATABASE_DESIGN.md` (ownership, audit/localization/soft-delete/versioning/retention attributes per entity — §5 of that document is this document's direct input), `SYSTEM_ARCHITECTURE.md` §4–§8 (module boundaries this schema must respect), `ADR-0006-database-baseline.md` (UUID v7, UTC timestamps, Decimal money, Amount/Currency pairs, Audit/Activity Log separation, cross-module access rule — binding on every model below), `LOCALIZATION.md` (§8), `SECURITY.md` §5 (data classification, applied per field where relevant), `AI_STRATEGY.md`, `AI_AGENTS.md`, `ADR-0008-ai-agent-boundaries.md` (§10).
- **Status:** Approved v1.0 — Locked. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## A Note on Method

Per instruction, this document faithfully implements existing documentation and introduces nothing new at the business level. Two categories of finding are called out explicitly rather than silently handled:

1. **Resolutions of decisions explicitly deferred to "schema design"** — `DATABASE_DESIGN.md` §20 Open Decision #7 explicitly deferred the table-inheritance mechanism for `Vehicle`/`Asset` and `Experience`/`Service` to "a schema-design-level decision appropriately deferred past this document's scope." This document *is* that schema-design level — resolving it here is fulfilling that deferral, not introducing an unauthorized architectural change. Stated plainly in §4 where it occurs.
2. **Genuine unresolved contradictions or gaps**, not resolved here, reported instead — most significantly, `DOMAIN_MODEL.md`'s own Open Question #1 (whether one `User` may hold multiple roles simultaneously — e.g. a Staff member who is also a personal Customer) was never actually resolved by any subsequent document. This document cannot model `User`-to-profile relationships definitively without that answer. It is flagged in §16 and Open Questions, and the schema below is modeled in the way least likely to foreclose either answer (see §4, `User`).

No field, entity, or relationship below exists without a traceable source in `DOMAIN_MODEL.md` or `DATABASE_DESIGN.md`. Where a field is a reasonable, necessary implementation-level derivation from a stated business fact (e.g. `Booking` needs a foreign key to `Customer` because `DOMAIN_MODEL.md` states "belongs to one Customer"), that derivation is made without further comment. Where something is genuinely invented or assumed beyond what's documented, it is not included — the gap is reported instead.

---

## 1. Executive Summary

`DOMAIN_MODEL.md` defines BARQ's business entities, relationships, and invariants; `DATABASE_DESIGN.md` defines the data-architecture rules (ownership, audit, localization, soft-delete, versioning, retention) every entity must follow; `SYSTEM_ARCHITECTURE.md` defines the module boundaries within which each entity's data must stay. This document is where those three layers converge into something an engineer can directly author `schema.prisma` from — every model, every field's presence and nullability, every relation, every enum, every index — without yet writing a single line of Prisma syntax. Its job is fidelity, not creativity: nothing here should surprise someone who has read the three documents above carefully; if it does, that surprise is the flag this document exists to raise (see Open Questions).

## 2. Design Principles

- **Single Source of Truth:** Every field exists in exactly one model. No entity's data is duplicated across two tables (`ARCHITECTURE_PRINCIPLES.md` Principle 2, `DATABASE_DESIGN.md` §2).
- **Normalization Philosophy:** Normalized by default (per `DOMAIN_MODEL.md`'s relational structure); the one documented exception is `Booking`'s `Price`/`Commission` snapshot, which is a deliberate, bounded denormalization required by the fixed-at-confirmation invariant (`DOMAIN_MODEL.md` Booking; `DATABASE_DESIGN.md` §4's Shared Data Rules) — not a general pattern, a single named exception.
- **Immutable Financial Records:** `Wallet Transaction`, `Payment` (post-capture), `Invoice` (post-issuance), and `Contract` (post-signature) are never updated in place, per `DATABASE_DESIGN.md` §5/§15/§18 — modeled below with no update path for their settled state.
- **Soft Delete Strategy:** Applied per entity exactly as `DATABASE_DESIGN.md` §5 specifies — never uniformly, never invented per-model beyond what that table already states.
- **Auditability:** Every entity `DATABASE_DESIGN.md` §5 marks Audit-relevant carries the audit fields in §9 below; every entity it marks otherwise does not gain them speculatively.
- **UUID Strategy:** UUID v7 for every primary key, per `ADR-0006` — no exception, no model-specific deviation.
- **Timestamp Strategy:** UTC storage for every timestamp field, per `ADR-0006` — presentation-layer conversion is out of scope here.

## 3. Entity Inventory

Reference only — Purpose and Lifecycle are fully owned by `DOMAIN_MODEL.md`, not repeated:

| Entity | Owning Context | Primary Relationships |
|---|---|---|
| User | Identity | Optionally extended by Customer, Provider-side profile, Staff, Admin |
| Customer | Customer | 1 User; many Bookings, Reviews; 0–1 Wallet |
| Provider | Provider | 1 User; many Drivers/Guides/Vehicles/Assets/Services/Experiences; 1 active Commission; 1 Wallet |
| Driver | Provider | 1 Provider |
| Guide | Provider | 1 Provider |
| Vehicle | Provider | Specializes Asset; 1 Provider |
| Asset | Provider | 1 Provider; specialized by Vehicle |
| Service | Provider | 1 Provider; 1 current Price; 1 Availability; specialized by Experience |
| Experience | Provider | Specializes Service |
| Booking | Booking | 1 Customer; 1 Service/Experience; 1 Price/Commission snapshot; 1 Journey; 0–1 Invoice/Payment/Review |
| Journey | Tracking | 1 Booking; many Route recordings |
| Route | Tracking | 1 Journey |
| Availability | Provider | 1 Service |
| Price | Pricing | 1 Service; referenced (snapshotted) by many Bookings |
| Commission | Pricing | 1 Provider (current); referenced (snapshotted) by many Bookings |
| Wallet | Wallet | 1 Provider or Customer; many Wallet Transactions |
| Wallet Transaction | Wallet | 1 Wallet |
| Payment | Payments | 1 Booking |
| Invoice | Invoicing | 1 Booking |
| Contract | Contracts | 1 Provider or Customer |
| Notification | Notifications | 1 User |
| Review | Reviews | 1 Booking; 1 Customer; 1 Rating |
| Rating | Reviews | 1 Review |
| Support Ticket | Operations | Typically 1 Booking; raised by Customer or Provider |
| Staff | Administration | 1 User |
| Admin | Administration | 1 User |
| AI Agent | AI | No entity-to-entity FK relationships — references other data only through governed reads, per `ADR-0008` |

## 4. Model Specification

Every model uses UUID v7 primary keys and UTC timestamps by default (§2) — not repeated per model below.

### User
- **Purpose:** Base identity record (`DOMAIN_MODEL.md`).
- **Fields:** phone number (unique, required), verification status, session/credential reference (mechanics owned by `AUTHENTICATION.md`, out of scope here), role flags or profile links (see note), status.
- **Required:** phone number, status.
- **Optional:** none beyond profile links.
- **Relations:** Optional one-to-one to Customer, Provider-side profile, Staff, Admin. **Unresolved:** whether a `User` may hold more than one of these simultaneously is `DOMAIN_MODEL.md`'s own Open Question #1, never resolved by any later document. This model is specified with independent, optional one-to-one relations to each profile type — a structure compatible with either answer (one User, one role only vs. one User, multiple roles) rather than one that silently forecloses the question. **This is reported, not resolved** — see §16, Open Questions.
- **Enums:** UserStatus (CREATED, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED).
- **Indexes:** phone number (unique).
- **Unique Constraints:** phone number.
- **Soft Delete Support:** Yes — Deactivated is a status value, not a delete.
- **Audit Fields:** createdAt, updatedAt; Audit Log entries for role/credential changes (external to this model, per `DATABASE_DESIGN.md` §9).

### Customer
- **Purpose:** Traveler profile (`DOMAIN_MODEL.md`).
- **Fields:** User reference, preferences, language preference (`LOCALIZATION.md` §3).
- **Required:** User reference.
- **Optional:** preferences, language preference (defaults to platform default per `LOCALIZATION.md` §3 if unset).
- **Relations:** 1 User (required); many Bookings; many Reviews; 0–1 Wallet.
- **Enums:** none additional.
- **Indexes:** User reference (unique).
- **Unique Constraints:** User reference.
- **Soft Delete Support:** Yes — Deactivated/Dormant per `DOMAIN_MODEL.md` Customer lifecycle.
- **Audit Fields:** createdAt, updatedAt; Activity Log for profile changes (per `DATABASE_DESIGN.md` §5, Partial audit requirement).

### Provider
- **Purpose:** Service Provider business entity (`DOMAIN_MODEL.md`).
- **Fields:** User reference, business name (bilingual — §8), business description (bilingual), status, current Contract reference, current Commission reference.
- **Required:** User reference, business name (both languages, per `ADR-0005`), status.
- **Optional:** business description.
- **Relations:** 1 User; many Drivers/Guides/Vehicles/Assets/Services/Experiences; 1 active Commission (via Commission's own Provider reference); 1 Wallet; 1 active Contract.
- **Enums:** ProviderStatus (APPLIED, UNDER_REVIEW, APPROVED, SUSPENDED, DEACTIVATED).
- **Indexes:** status (for Admin approval-queue queries); User reference (unique).
- **Unique Constraints:** User reference.
- **Soft Delete Support:** No hard delete; Suspended/Deactivated are status values, per `DOMAIN_MODEL.md` invariant that a Provider is never truly removed while historical Bookings reference it.
- **Audit Fields:** createdAt, updatedAt; Audit Log for approval/suspension (per `DATABASE_DESIGN.md` §5, Audit = Yes).

### Driver
- **Purpose:** Individual operating a Vehicle on behalf of a Provider (`DOMAIN_MODEL.md`).
- **Fields:** Provider reference, display name (bilingual — Partial per `DATABASE_DESIGN.md` §5), license/eligibility status.
- **Required:** Provider reference, display name, status.
- **Optional:** none beyond descriptive detail not specified elsewhere.
- **Relations:** 1 Provider; assignable to many Bookings (one active at a time, per invariant).
- **Enums:** DriverStatus (REGISTERED, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED).
- **Indexes:** Provider reference; status.
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Yes — Deactivated status.
- **Audit Fields:** createdAt, updatedAt; Audit Log for registration/verification (per `DATABASE_DESIGN.md` §5, Audit = Yes).

### Guide
- **Purpose:** Individual delivering guided Experiences on behalf of a Provider (`DOMAIN_MODEL.md`).
- **Fields / Required / Optional / Relations / Enums / Indexes / Unique / Soft Delete / Audit:** Identical structure to Driver above, substituting Guide's own qualification/eligibility status for Driver's license status — per `DOMAIN_MODEL.md`, Guide and Driver are structurally parallel entities.
- **Enums:** GuideStatus (REGISTERED, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED).

### Vehicle
- **Purpose:** A specific type of Asset used for transport (`DOMAIN_MODEL.md`).
- **Resolving `DATABASE_DESIGN.md` §20 Open Decision #7:** Modeled as **Class Table Inheritance** — `Vehicle` is its own table sharing its primary key with its owning `Asset` row (a one-to-one relation keyed on the same ID), rather than a single merged table or a type-discriminator column on `Asset` alone. This choice is made because `Asset` is explicitly documented as "deliberately generic to allow future asset types beyond vehicles" (`DOMAIN_MODEL.md`) — Class Table Inheritance lets a future Asset specialization (e.g. a boat) add its own table without altering `Vehicle`'s or `Asset`'s existing structure, which a single merged table with growing nullable columns would not do cleanly. This is a schema-design-level decision, explicitly the kind `DATABASE_DESIGN.md` deferred to this document — not a new architectural decision.
- **Fields:** Asset reference (shared primary key), registration details, plate/identifier, vehicle-specific descriptive fields (bilingual, Partial per `DATABASE_DESIGN.md` §5).
- **Required:** Asset reference, registration details.
- **Relations:** 1 Asset (specialization, shared key); inherits Asset's Provider ownership through Asset.
- **Enums:** shares AssetStatus (below) rather than its own — status belongs to the base `Asset` record.
- **Indexes:** registration/plate identifier.
- **Unique Constraints:** registration/plate identifier (if legally unique); Asset reference (unique, enforcing the 1:1 specialization).
- **Soft Delete Support:** Yes — via Asset's status.
- **Audit Fields:** createdAt, updatedAt; Audit Log for registration/verification (per `DATABASE_DESIGN.md` §5, Audit = Yes).

### Asset
- **Purpose:** Generic registrable resource owned by a Provider (`DOMAIN_MODEL.md`).
- **Fields:** Provider reference, asset type indicator (to know which specialization table, if any, to join — e.g. "VEHICLE"), status.
- **Required:** Provider reference, asset type indicator, status.
- **Relations:** 1 Provider; optionally specialized by exactly one Vehicle row (see above).
- **Enums:** AssetStatus (REGISTERED, VERIFIED, ACTIVE, UNDER_MAINTENANCE, DEACTIVATED); AssetType (VEHICLE — the only current specialization per `DOMAIN_MODEL.md`; the enum is deliberately open to future values, not closed to one, consistent with Asset's own documented generality).
- **Indexes:** Provider reference; status; asset type.
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Yes — Deactivated status.
- **Audit Fields:** createdAt, updatedAt; Audit Log for registration/verification.

### Service
- **Purpose:** A bookable offering listed by a Provider (`DOMAIN_MODEL.md`).
- **Fields:** Provider reference, name (bilingual, required per `DATABASE_DESIGN.md` §5 Localization = Yes), description (bilingual), status, current Price reference, Availability reference, service type indicator (for Experience specialization, mirroring Asset/Vehicle's pattern).
- **Required:** Provider reference, name (both languages), status.
- **Optional:** description.
- **Relations:** 1 Provider; 1 current Price (via Price's own Service reference); 1 Availability; optionally specialized by exactly one Experience row (Class Table Inheritance, same reasoning as Vehicle/Asset above).
- **Enums:** ServiceStatus (DRAFT, PUBLISHED, PAUSED, ARCHIVED).
- **Indexes:** Provider reference; status (for discovery queries — Public-facing, per `SECURITY.md` §5's Public classification for published listings).
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Archived status; never hard-deleted while any Booking references it, per `DATABASE_DESIGN.md` §5.
- **Audit Fields:** createdAt, updatedAt; Activity Log for publish/pause transitions (Partial audit per `DATABASE_DESIGN.md` §5).

### Experience
- **Purpose:** A specialized Service representing a curated tourism experience (`DOMAIN_MODEL.md`).
- **Fields:** Service reference (shared primary key), guiding-specific descriptive content (bilingual).
- **Required:** Service reference.
- **Relations:** 1 Service (specialization, shared key, Class Table Inheritance per the Vehicle/Asset reasoning above); may reference a required Guide role on the resulting Booking (per `DOMAIN_MODEL.md` invariant — enforced at Booking confirmation, not on this model itself).
- **Enums:** shares ServiceStatus rather than its own.
- **Indexes:** Service reference (unique, enforcing the 1:1 specialization).
- **Unique Constraints:** Service reference.
- **Soft Delete Support:** Yes — via Service's status.
- **Audit Fields:** createdAt, updatedAt; Activity Log, same as Service.

### Booking
- **Purpose:** The confirmed commercial commitment between Customer and Provider (`DOMAIN_MODEL.md`).
- **Fields:** Customer reference, Service/Experience reference, Provider reference (denormalized for query convenience — derivable from Service, but frequently filtered on directly; flagged as a candidate for confirmation during actual schema authoring rather than assumed necessary here — see §16), Price snapshot (Amount + Currency, per `ADR-0006`), Commission snapshot (amount + tier reference), status, assigned Driver/Guide/Vehicle references (nullable until assignment), confirmation timestamp.
- **Required:** Customer reference, Service/Experience reference, status.
- **Optional:** assigned Driver/Guide/Vehicle references (populated only after assignment); Price/Commission snapshot (populated only at confirmation, per the fixed-at-confirmation invariant — null before that point).
- **Relations:** 1 Customer; 1 Service or Experience; 0–1 Driver, 0–1 Guide, 0–1 Vehicle (assignment); 1 Journey (produced on confirmation); 0–1 Invoice; 0–1 Payment; 0–1 Review.
- **Enums:** BookingStatus (CREATED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, DISPUTED).
- **Indexes:** Customer reference; Provider reference; status; confirmation timestamp (for reporting).
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Never hard-deleted (financial/legal record, per `DATABASE_DESIGN.md` §5/§18); Cancelled is a status, not a deletion.
- **Audit Fields:** createdAt, updatedAt; Audit Log for all state transitions and cancellations (Audit = Yes per `DATABASE_DESIGN.md` §5).

### Journey
- **Purpose:** Live execution of a confirmed Booking (`DOMAIN_MODEL.md`).
- **Fields:** Booking reference, status, start timestamp, completion timestamp.
- **Required:** Booking reference, status.
- **Optional:** start/completion timestamps (populated as the Journey progresses).
- **Relations:** 1 Booking; many Route recordings.
- **Enums:** JourneyStatus (NOT_STARTED, STARTED, IN_PROGRESS, COMPLETED, INTERRUPTED).
- **Indexes:** Booking reference (unique — one Journey per Booking).
- **Unique Constraints:** Booking reference.
- **Soft Delete Support:** Never deleted once Completed, per `DATABASE_DESIGN.md` §5.
- **Audit Fields:** createdAt, updatedAt; Activity Log for start/complete (Partial per `DATABASE_DESIGN.md` §5).

### Route
- **Purpose:** Recorded/planned path of a Journey (`DOMAIN_MODEL.md`).
- **Fields:** Journey reference, location recordings (structure of individual points is an implementation detail, out of scope here), status.
- **Required:** Journey reference, status.
- **Relations:** 1 Journey.
- **Enums:** RouteStatus (PLANNED, RECORDING, FINALIZED).
- **Indexes:** Journey reference.
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Never deleted once finalized, per `DOMAIN_MODEL.md` invariant — immutable.
- **Audit Fields:** createdAt only — no updatedAt in the usual sense once finalized, since the record becomes immutable; per `DATABASE_DESIGN.md` §5, Audit = No (operational, not compliance-audit data), though the immutability itself is enforced regardless.

### Availability
- **Purpose:** Schedule defining when a Service can be booked (`DOMAIN_MODEL.md`).
- **Fields:** Service reference, time slot definitions, open/blocked state per slot.
- **Required:** Service reference, slot data.
- **Relations:** 1 Service.
- **Enums:** AvailabilitySlotState (OPEN, BOOKED, BLOCKED).
- **Indexes:** Service reference; time range (for booking-query performance, per `DATABASE_DESIGN.md` §12).
- **Unique Constraints:** none beyond primary key — a Service may have many Availability records over time.
- **Soft Delete Support:** Not soft-deleted in the traditional sense — slots are consumed/replaced (`DATABASE_DESIGN.md` §5); short-term retention, prunable after expiry.
- **Audit Fields:** createdAt, updatedAt; Activity Log only (Audit = No per `DATABASE_DESIGN.md` §5).

### Price
- **Purpose:** Provider-set chargeable amount for a Service (`DOMAIN_MODEL.md`).
- **Fields:** Service reference, amount, currency, effective status.
- **Required:** Service reference, amount, currency.
- **Relations:** 1 Service; referenced (snapshotted, not foreign-keyed at read time) by Bookings made against that Service while this Price was active.
- **Enums:** PriceStatus (ACTIVE, SUPERSEDED).
- **Indexes:** Service reference; status (to find the currently-active Price quickly).
- **Unique Constraints:** at most one ACTIVE Price per Service at a time — enforced at the application/Domain layer per `DOMAIN_MODEL.md`'s invariant, not purely a database uniqueness constraint, since "superseded" rows must coexist historically.
- **Soft Delete Support:** Never hard-deleted; superseded, not deleted, per `DATABASE_DESIGN.md` §5.
- **Audit Fields:** createdAt; Audit Log for every change (Audit = Yes per `DATABASE_DESIGN.md` §5, since Price changes affect Commission and therefore money).

### Commission
- **Purpose:** BARQ's commission percentage for a Provider (`DOMAIN_MODEL.md`).
- **Fields:** Provider reference, tier (percentage value), effective status.
- **Required:** Provider reference, tier value.
- **Relations:** 1 Provider (current); referenced (snapshotted) by Bookings confirmed while this Commission was active.
- **Enums:** CommissionTier (TIER_12, TIER_10, TIER_8 — per `GLOSSARY.md` term 19's three defined rates); CommissionStatus (ACTIVE, SUPERSEDED).
- **Indexes:** Provider reference; status.
- **Unique Constraints:** exactly one ACTIVE Commission per Provider at a time — same enforcement note as Price above.
- **Soft Delete Support:** Never hard-deleted; superseded, per `DATABASE_DESIGN.md` §5.
- **Audit Fields:** createdAt; Audit Log for every tier change (Audit = Yes — tier changes are Admin Configuration Changed events per `DOMAIN_MODEL.md` §3).

### Wallet
- **Purpose:** BARQ-managed balance for a Provider or Customer (`DOMAIN_MODEL.md`).
- **Fields:** owner reference (Provider or Customer — mutually exclusive; see Relations), balance (derived, never directly written).
- **Required:** owner reference.
- **Relations:** exactly one of Provider or Customer (not both) — modeled as two optional, mutually-exclusive foreign keys with an application/Domain-layer invariant enforcing exactly one is set, since Prisma has no native "exactly one of" constraint; many Wallet Transactions.
- **Enums:** none.
- **Indexes:** Provider reference; Customer reference.
- **Unique Constraints:** Provider reference (unique, where set); Customer reference (unique, where set) — one Wallet per owner.
- **Soft Delete Support:** Never deleted; zero-balanced only, per `DOMAIN_MODEL.md` invariant.
- **Audit Fields:** createdAt, updatedAt; Audit Log for balance-affecting events (Audit = Yes per `DATABASE_DESIGN.md` §5) — noting the balance itself is never directly updated, only derived from Wallet Transactions (below).

### Wallet Transaction
- **Purpose:** Single immutable ledger entry (`DOMAIN_MODEL.md`).
- **Fields:** Wallet reference, direction (credit/debit), amount, currency, business cause reference (which Booking/Payment/Commission event caused it), description.
- **Required:** Wallet reference, direction, amount, currency, business cause reference.
- **Relations:** 1 Wallet; references the causing Booking/Payment/Commission record (polymorphic reference — exact mechanism, e.g. a typed reference table vs. nullable FKs per cause type, is an implementation detail flagged in §16, not decided here).
- **Enums:** WalletTransactionDirection (CREDIT, DEBIT). A more granular WalletTransactionCause enum (e.g. COMMISSION_DEDUCTION, PAYOUT, REFUND_ADJUSTMENT) is **not fully specified** anywhere in prior documentation — `DOMAIN_MODEL.md` gives only illustrative examples ("e.g. Commission deduction, Payout"), not an exhaustive list. This gap is reported in §16 rather than an invented complete enum being presented as authoritative.
- **Indexes:** Wallet reference; created timestamp (ledger is read in chronological order frequently).
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** None — never deleted or edited, ever; corrections are new offsetting entries, per `DOMAIN_MODEL.md` invariant.
- **Audit Fields:** createdAt only — this table *is* the audit-grade record; no updatedAt exists because nothing is ever updated.

### Payment
- **Purpose:** Money captured from a Customer for a Booking (`DOMAIN_MODEL.md`).
- **Fields:** Booking reference, amount, currency, status, capture timestamp, refund amount (if any).
- **Required:** Booking reference, amount, currency, status.
- **Optional:** capture timestamp (until captured), refund amount (until/unless refunded).
- **Relations:** 1 Booking; triggers Wallet Transaction(s) for the relevant Provider (referenced from the Wallet Transaction side, per the polymorphic-reference note above).
- **Enums:** PaymentStatus (INITIATED, CAPTURED, REFUNDED_PARTIAL, REFUNDED_FULL, FAILED).
- **Indexes:** Booking reference (unique — one Payment per Booking, per `DOMAIN_MODEL.md`'s relationship); status.
- **Unique Constraints:** Booking reference.
- **Soft Delete Support:** Never hard-deleted, per `DATABASE_DESIGN.md` §5/§18.
- **Audit Fields:** createdAt, updatedAt (status transitions); Audit Log for every transition (Audit = Yes).

### Invoice
- **Purpose:** Legal transactional record of a billable Booking (`DOMAIN_MODEL.md`).
- **Fields:** Booking reference, sequential invoice number, bilingual content (rendered document data or reference to it), issuance timestamp, superseding Credit Note reference (if any).
- **Required:** Booking reference, invoice number, issuance timestamp.
- **Optional:** superseding Credit Note reference.
- **Relations:** 1 Booking.
- **Enums:** InvoiceStatus (GENERATED, ISSUED, SUPERSEDED_BY_CREDIT_NOTE).
- **Indexes:** Booking reference; invoice number.
- **Unique Constraints:** invoice number (sequential and gapless, per `DOMAIN_MODEL.md` invariant — gaplessness itself is an application-layer guarantee, not something a unique constraint alone enforces).
- **Soft Delete Support:** Never deleted or edited once issued; corrected via a Credit Note record (a new Invoice-like record referencing the original), per `DOMAIN_MODEL.md` invariant.
- **Audit Fields:** createdAt only (immutable once issued); Audit Log for issuance (Audit = Yes).

### Contract
- **Purpose:** Legally binding agreement with a Provider or Customer (`DOMAIN_MODEL.md`).
- **Fields:** party reference (Provider or Customer, mutually exclusive, same pattern as Wallet), bilingual terms content, status, signature timestamp, superseding Contract reference (if any).
- **Required:** party reference, status.
- **Optional:** signature timestamp (until signed), superseding Contract reference.
- **Relations:** 1 Provider or 1 Customer (mutually exclusive); may reference a prior Contract it supersedes.
- **Enums:** ContractStatus (DRAFTED, SENT, SIGNED, ACTIVE, SUPERSEDED, TERMINATED).
- **Indexes:** Provider reference; Customer reference; status.
- **Unique Constraints:** at most one ACTIVE Contract per party — application-layer invariant, same enforcement note as Price/Commission.
- **Soft Delete Support:** Never deleted or edited once Signed; superseded by a new Contract, per `DOMAIN_MODEL.md` invariant.
- **Audit Fields:** createdAt, updatedAt (pre-signature only); Audit Log for signature/termination (Audit = Yes).

### Notification
- **Purpose:** Message delivered to a User (`DOMAIN_MODEL.md`).
- **Fields:** User reference, bilingual content, channel, status, causing event reference (polymorphic, same note as Wallet Transaction).
- **Required:** User reference, content (both languages, per `ADR-0005` and the entity's own invariant), channel, status.
- **Relations:** 1 User; references the causing domain event (informational, not a hard FK necessarily).
- **Enums:** NotificationChannel (WHATSAPP, EMAIL, SMS — per `TECH_STACK.md` §10); NotificationStatus (COMPOSED, SENT, DELIVERED, FAILED).
- **Indexes:** User reference; status; created timestamp.
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Soft delete/prunable after a retention window — exact duration is `DATABASE_DESIGN.md` §20's own still-open item, not re-decided here.
- **Audit Fields:** createdAt, updatedAt; Activity Log, with delivery logs potentially referenced as Dispute evidence (Partial audit per `DATABASE_DESIGN.md` §5).

### Review
- **Purpose:** Customer feedback on a completed Booking (`DOMAIN_MODEL.md`).
- **Fields:** Booking reference, Customer reference, free-text content, moderation state.
- **Required:** Booking reference, Customer reference, content.
- **Relations:** 1 Booking; 1 Customer; 1 Rating.
- **Enums:** ReviewModerationState (PUBLISHED, FLAGGED, REMOVED) — **the actual moderation policy governing when/why a Review moves between these states is undefined anywhere in prior documentation** (`DOMAIN_MODEL.md` Open Question #3, `DATABASE_DESIGN.md` §20 Open Decision #5). The states themselves are a reasonable structural placeholder for that undefined policy, not an invented policy — reported in §16.
- **Indexes:** Booking reference (unique — one Review per Booking, per invariant); Customer reference; Provider reference (denormalized, for a Provider's aggregate rating queries — flagged in §16 as a candidate field to confirm, same as Booking's Provider reference).
- **Unique Constraints:** Booking reference.
- **Soft Delete Support:** Soft delete, pending the undefined moderation policy above.
- **Audit Fields:** createdAt; no Audit Log requirement per `DATABASE_DESIGN.md` §5 (Audit = No), though moderation actions, if the policy is ever defined, may need to become Audit-relevant at that point.

### Rating
- **Purpose:** Numeric score accompanying a Review (`DOMAIN_MODEL.md`).
- **Fields:** Review reference, numeric value.
- **Required:** Review reference, numeric value.
- **Relations:** 1 Review.
- **Enums:** none — a bounded numeric range (e.g. 1–5) is implied by "Rating" generally but never explicitly stated as a specific range anywhere in `DOMAIN_MODEL.md`; flagged in §16 rather than assumed.
- **Indexes:** Review reference (unique).
- **Unique Constraints:** Review reference.
- **Soft Delete Support:** Tied to its Review — removed together, if ever, per `DOMAIN_MODEL.md`.
- **Audit Fields:** createdAt only — immutable per invariant.

### Support Ticket
- **Purpose:** Record of an issue requiring Staff attention (`DOMAIN_MODEL.md`).
- **Fields:** raiser reference (Customer or Provider, mutually exclusive), Booking reference (typical, not universal), subject/content, status, financial-resolution reference (if applicable).
- **Required:** raiser reference, content, status.
- **Optional:** Booking reference (not every ticket references one, per `DOMAIN_MODEL.md`'s "typically references"); financial-resolution reference.
- **Relations:** 1 Customer or 1 Provider (raiser); 0–1 Booking; 0–1 financial resolution (Payment/Wallet Transaction reference).
- **Enums:** SupportTicketStatus (OPENED, IN_PROGRESS, ESCALATED, RESOLVED, CLOSED).
- **Indexes:** raiser reference; Booking reference; status.
- **Unique Constraints:** none beyond primary key.
- **Soft Delete Support:** Soft delete/closeable; never hard-deleted if linked to a financial resolution, per `DOMAIN_MODEL.md` invariant.
- **Audit Fields:** createdAt, updatedAt; Audit Log required specifically when a financial resolution is attached (Partial per `DATABASE_DESIGN.md` §5).

### Staff
- **Purpose:** BARQ operations team member (`DOMAIN_MODEL.md`).
- **Fields:** User reference, role assignment(s) (Operations/Support/Finance, per `IDENTITY_AND_ACCESS.md` §3 — an authorization-layer concept represented here as data), status.
- **Required:** User reference, at least one role assignment, status.
- **Relations:** 1 User; role assignment representation — modeled as a multi-value field or a join table (exact mechanism an implementation choice, flagged in §16) since `IDENTITY_AND_ACCESS.md` explicitly allows one Staff member to hold more than one role.
- **Enums:** StaffRole (OPERATIONS, SUPPORT, FINANCE); StaffStatus (ACTIVE, DEACTIVATED).
- **Indexes:** User reference (unique).
- **Unique Constraints:** User reference.
- **Soft Delete Support:** Yes — Deactivated status.
- **Audit Fields:** createdAt, updatedAt; Audit Log for the Staff member's own account changes (Audit = Yes) — separate from the Audit Log entries their *actions* generate elsewhere.

### Admin
- **Purpose:** BARQ configuration/approval authority role (`DOMAIN_MODEL.md`).
- **Fields:** User reference, status.
- **Required:** User reference, status.
- **Relations:** 1 User.
- **Enums:** AdminStatus (ACTIVE, DEACTIVATED).
- **Indexes:** User reference (unique).
- **Unique Constraints:** User reference.
- **Soft Delete Support:** Yes — Deactivated status.
- **Audit Fields:** createdAt, updatedAt; Audit Log for the Admin's own account changes.

### AI Agent
- **Purpose:** Definition record for an autonomous/semi-autonomous platform capability (`DOMAIN_MODEL.md`, `AI_AGENTS.md`).
- **Fields:** name/role identifier, version, status, governing specification reference (points to the relevant section of `AI_AGENTS.md` conceptually — not a live document link).
- **Required:** name/role identifier, version, status.
- **Relations:** None to other business entities directly — per `ADR-0008` point 3, an AI Agent never holds a foreign key into another module's data; all its "access" is through governed reads at the application layer, never modeled as a database relationship.
- **Enums:** AIAgentStatus (DEFINED, DEPLOYED, SUSPENDED, RETIRED).
- **Indexes:** name/role identifier; status.
- **Unique Constraints:** name/role identifier + version (an agent definition is versioned, per `AI_STRATEGY.md` §7's Prompt Versioning pattern applied to the agent definition itself).
- **Soft Delete Support:** Retired, never deleted, per `AI_STRATEGY.md` §7's retirement pattern.
- **Audit Fields:** createdAt, updatedAt; Audit Log for every definition/deployment change (Audit = Yes).

## 5. Relationship Matrix

- **One-to-One:** User↔Customer, User↔Provider-profile, User↔Staff, User↔Admin (each optional, per §4's unresolved-exclusivity note); Asset↔Vehicle, Service↔Experience (Class Table Inheritance); Review↔Rating; Journey↔Booking.
- **One-to-Many:** Provider→Driver/Guide/Vehicle/Asset/Service/Experience; Wallet→Wallet Transaction; Journey→Route; Service→Availability (over time); Service/Provider→Price/Commission (historical versions); Customer→Booking/Review.
- **Many-to-Many:** None identified as required by `DOMAIN_MODEL.md`'s current entity set — consistent with `DATABASE_DESIGN.md` §6's own finding; not introduced speculatively here either.
- **Ownership:** Every model's owning Bounded Context is stated in §3 and unchanged from `DOMAIN_MODEL.md`/`DATABASE_DESIGN.md` §4 — this document does not alter any ownership assignment.
- **Cascade Rules:** No cascade deletes on any financial, legal, or audit-relevant model (Booking, Payment, Invoice, Contract, Wallet Transaction) — deletion is structurally prevented, not merely discouraged, per `DATABASE_DESIGN.md` §18's anti-pattern. Cascade deletes are limited to genuinely dependent, non-financial child records (e.g. deleting a draft Availability slot that was never booked).
- **Deletion Strategy:** Soft delete per §4's per-model specification; hard delete never occurs for any model marked "Never hard-deleted" above — this is an absolute constraint carried forward from `DATABASE_DESIGN.md` §5/§15/§18, not re-decided here.

## 6. Enum Catalogue

| Enum | Purpose | Possible Values | Owning Document |
|---|---|---|---|
| UserStatus | User lifecycle | CREATED, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED | `DOMAIN_MODEL.md` User lifecycle |
| ProviderStatus | Provider lifecycle | APPLIED, UNDER_REVIEW, APPROVED, SUSPENDED, DEACTIVATED | `DOMAIN_MODEL.md` Provider lifecycle |
| DriverStatus / GuideStatus | Driver/Guide lifecycle | REGISTERED, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED | `DOMAIN_MODEL.md` |
| AssetStatus | Asset/Vehicle lifecycle | REGISTERED, VERIFIED, ACTIVE, UNDER_MAINTENANCE, DEACTIVATED | `DOMAIN_MODEL.md` |
| AssetType | Asset specialization discriminator | VEHICLE (open to future values) | `DOMAIN_MODEL.md` (Asset's documented generality) |
| ServiceStatus | Service/Experience lifecycle | DRAFT, PUBLISHED, PAUSED, ARCHIVED | `DOMAIN_MODEL.md` |
| BookingStatus | Booking lifecycle | CREATED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, DISPUTED | `DOMAIN_MODEL.md` Booking lifecycle |
| JourneyStatus | Journey lifecycle | NOT_STARTED, STARTED, IN_PROGRESS, COMPLETED, INTERRUPTED | `DOMAIN_MODEL.md` |
| RouteStatus | Route lifecycle | PLANNED, RECORDING, FINALIZED | `DOMAIN_MODEL.md` |
| AvailabilitySlotState | Slot state | OPEN, BOOKED, BLOCKED | `DOMAIN_MODEL.md` |
| PriceStatus / CommissionStatus | Versioning state | ACTIVE, SUPERSEDED | `DOMAIN_MODEL.md` |
| CommissionTier | Commission rate | TIER_12, TIER_10, TIER_8 | `GLOSSARY.md` term 19 |
| WalletTransactionDirection | Ledger direction | CREDIT, DEBIT | `DOMAIN_MODEL.md` |
| PaymentStatus | Payment lifecycle | INITIATED, CAPTURED, REFUNDED_PARTIAL, REFUNDED_FULL, FAILED | `DOMAIN_MODEL.md` |
| InvoiceStatus | Invoice lifecycle | GENERATED, ISSUED, SUPERSEDED_BY_CREDIT_NOTE | `DOMAIN_MODEL.md` |
| ContractStatus | Contract lifecycle | DRAFTED, SENT, SIGNED, ACTIVE, SUPERSEDED, TERMINATED | `DOMAIN_MODEL.md` |
| NotificationChannel | Delivery channel | WHATSAPP, EMAIL, SMS | `TECH_STACK.md` §10 |
| NotificationStatus | Delivery lifecycle | COMPOSED, SENT, DELIVERED, FAILED | `DOMAIN_MODEL.md` |
| ReviewModerationState | Moderation placeholder | PUBLISHED, FLAGGED, REMOVED | Structural placeholder only — policy undefined (§4, §16) |
| SupportTicketStatus | Ticket lifecycle | OPENED, IN_PROGRESS, ESCALATED, RESOLVED, CLOSED | `DOMAIN_MODEL.md` |
| StaffRole | Staff role assignment | OPERATIONS, SUPPORT, FINANCE | `IDENTITY_AND_ACCESS.md` §3 |
| StaffStatus / AdminStatus | Account lifecycle | ACTIVE, DEACTIVATED | `DOMAIN_MODEL.md` |
| AIAgentStatus | Agent lifecycle | DEFINED, DEPLOYED, SUSPENDED, RETIRED | `AI_STRATEGY.md` §7 (Prompt/Agent lifecycle pattern) |

**Not modeled as enums, by deliberate choice:** Currency and Language codes are modeled as open string fields (e.g. ISO 4217, ISO 639-1/BCP-47), not closed enums — per `ADR-0006`'s explicit requirement that Currency "not assume OMR forever" and `ADR-0005` requirement 9's requirement that language support extend beyond two without a schema change. A closed enum would violate both.

## 7. Index Strategy

- **Business Indexes:** Foreign keys (every relation in §4/§5) and status fields used in operational queries (Provider approval queue, active Booking monitoring) are indexed by default.
- **Search Indexes:** Service/Experience name and description fields (bilingual) will need search-appropriate indexing once `LOCALIZATION.md` §9's normalization requirements (diacritic-insensitive Arabic matching, mixed-query support) are implemented — the specific index type (e.g. full-text vs. trigram) is an implementation detail deferred past this document.
- **Composite Indexes:** Candidates include (Provider reference + status) for Provider-scoped dashboards, and (Booking reference + status) equivalents — exact composite index selection is a performance-tuning decision, not fixed here (§16).
- **Unique Indexes:** Per §4's Unique Constraints for each model — phone number (User), Service reference (Experience), Asset reference (Vehicle), invoice number (Invoice), and others as listed.
- **Performance Philosophy:** Per `DATABASE_DESIGN.md` §12 — indexes support the concurrency-sensitive paths (`Availability` booking-race, `Price`/`Commission` active-lookup) as a first-class concern, not an afterthought added when a query is observed to be slow.

## 8. Multi-Language Data Strategy

Reference only — full architecture in `LOCALIZATION.md`, not restated:

Entities requiring bilingual fields, per `DATABASE_DESIGN.md` §5's Localization Requirement column: **Provider** (business name/description), **Driver**/**Guide** (display name, Partial), **Vehicle**/**Asset** (descriptive fields, Partial), **Service**/**Experience** (name/description, required), **Invoice** (document content, required), **Contract** (terms, required), **Notification** (content, required). All other models carry no localized content — their data is language-neutral (identifiers, amounts, timestamps, enums), per `DATABASE_DESIGN.md` §7's Non-Localized Content list. This document does not define the storage mechanism (translation table vs. locale-keyed columns) — that remains `DATABASE_DESIGN.md` §20's own still-open item.

## 9. Audit Strategy

- **Created By:** Present on every model where an action is attributable to a specific actor (Staff-created Customer, Admin-created Provider approval, etc.) — a reference to the acting User (human or, per `ADR-0008`, an AI Agent's own service identity where applicable).
- **Updated By:** Present on every mutable, Audit-relevant model (§4); absent on immutable models (Wallet Transaction, Route, Rating, and Invoice/Contract post-issuance/signature) since there is no update event to attribute.
- **Deleted By:** Present only on models with genuine soft-delete support (§4); absent on models that are never deleted at all (Wallet Transaction, Route, Rating).
- **Activity Log:** External to these models — a separate log store per `DATABASE_DESIGN.md` §9, referencing the relevant model/record rather than embedding log entries inside it.
- **Audit Log:** Same externalization as Activity Log, with the immutability and retention requirements `DATABASE_DESIGN.md` §9 and `SECURITY.md` §5 already establish — not modeled as a field on any business entity, modeled as its own append-only store.
- **Traceability:** Every Audit Log entry correlates back to the originating request via Correlation/Trace ID, per `API_CONTRACTS.md` §5/§16 — this document's models carry the foreign keys the Audit Log references; they do not carry the trace metadata itself.

## 10. AI Data Ownership

Per `ADR-0008` §3–§4, restated at the schema level, not redefined:

- **AI May Read:** Any model within an AI Agent's documented Inputs (`AI_AGENTS.md` §4–§10), always through a governed Application Layer interface — never a direct database connection or ORM query issued by the AI Layer itself.
- **AI May Never Modify:** `Wallet`, `Wallet Transaction`, `Payment`, `Invoice`, `Contract`, `Commission`, `Provider` (approval/suspension fields specifically), and `Audit Log`/`Activity Log` entries of any kind — per `ADR-0008` points 5–9. No AI Agent's governed interface, however it is eventually implemented, may expose a write path to any of these.
- **Schema-Level Enforcement Note:** This document does not itself enforce these boundaries (that is an application/permission-layer concern, per `SYSTEM_ARCHITECTURE.md` §12) — it records which models the enforcement must cover, so the boundary is traceable from the schema outward, not only from policy inward.

## 11. Migration Strategy

- **Migration Philosophy:** Additive by default — new fields are nullable or defaulted; existing fields are not repurposed for a new meaning.
- **Backward Compatibility:** A migration must not break a currently-deployed version of the application reading the previous schema shape, consistent with `PROJECT_RULES.md` §24's Breaking Change Policy.
- **Incremental Migrations:** Small, reviewable migrations preferred over large, batched ones — consistent with `ENGINEERING_GUIDE.md` §2's Small Iterations value.
- **No Destructive Migrations:** No migration drops a column or table containing Confidential/Restricted data (`SECURITY.md` §5) without an explicit, separately-reviewed data-retention decision preceding it — a destructive migration is never a routine step.

## 12. Validation Rules

- **Business Validation:** Domain invariants (`DOMAIN_MODEL.md`) — e.g. a Booking cannot confirm without an available Availability slot — are enforced in the Domain Layer, never assumed satisfied by database constraints alone.
- **Database Validation:** Structural integrity — required fields, foreign key existence, unique constraints (§4) — enforced by PostgreSQL itself as a second line of defense, per `DATABASE_DESIGN.md` §16.
- **Application Validation:** Input shape/format validation (`API_CONTRACTS.md` §7) happens before a request reaches the Domain Layer at all.
- **Boundary:** Database validation catches what Application/Business validation might miss due to a bug; it is never the primary or sole enforcement mechanism for a business rule.

## 13. Performance Considerations

- **Large Tables (anticipated):** `Wallet Transaction` (append-only, grows with every financial event), `Route` (high-frequency location data), `Notification` (high volume, per-event).
- **Partition Candidates:** The same three — flagged in `DATABASE_DESIGN.md` §12 as candidates, not committed for V1.
- **Future Scaling:** Per `DATABASE_DESIGN.md` §8/§19 — multi-tenant partitioning is not modeled in this document at all; V1 remains single-tenant, no tenant-scoping field exists on any model above, consistent with that document's "Current Architecture" statement.
- **Read-Heavy Models:** `Service`/`Experience` (discovery browsing), `Booking` (status polling), `Availability` (booking-flow checks).
- **Write-Heavy Models:** `Wallet Transaction`, `Route`, `Notification` — the same three flagged as large-table candidates above, for the same underlying reason.

## 14. Anti-Patterns

Explicitly forbidden, without exception, carried forward from `DATABASE_DESIGN.md` §18 and applied specifically at the schema-specification level:

- Never duplicate entities — every model in §4 corresponds to exactly one `DOMAIN_MODEL.md` entity; no model here has a redundant counterpart.
- Never duplicate relationships — a relationship is modeled once, from its natural owning side, not restated redundantly from both sides as if independent facts.
- Never bypass Audit — every model §9 designates as Audit-relevant has the fields/external log coverage to support it; none is specified without.
- Never bypass Soft Delete — every model's deletion behavior in §4 matches `DATABASE_DESIGN.md` §5 exactly; no model is specified with a laxer deletion path than that document allows.
- Never denormalize without justification — the only denormalization in this document (Booking's Price/Commission snapshot, and the flagged-for-confirmation Booking/Review Provider references) is named and justified explicitly, not introduced silently.
- Never store derived data unnecessarily — Wallet balance is explicitly modeled as derived from Wallet Transactions, never as an independently-writable field.
- Never violate Domain Model — every field, relation, and enum above traces to a stated fact in `DOMAIN_MODEL.md` or `DATABASE_DESIGN.md`; nothing here contradicts either.

## 15. Implementation Readiness Checklist

- **schema.prisma:** Ready — every model, field, relation, and enum needed is specified above at a level sufficient for direct authoring, modulo the Open Decisions in §16.
- **Migration 001:** Ready, contingent on §16's implementation-detail items (polymorphic reference mechanism, composite index selection) being resolved during actual authoring — none of them block starting.
- **Prisma Client:** Ready — no blocker beyond the schema itself being authored.
- **Repository Layer:** Ready — `SYSTEM_ARCHITECTURE.md` §4's layering (Domain Layer never depends on Infrastructure directly) is respected by this specification; nothing here requires the Domain Layer to know about Prisma-specific concepts.
- **API Layer:** Ready — `API_CONTRACTS.md`'s resource ownership (§4 of that document) maps cleanly onto this document's models, with no discovered mismatch.

## 16. Open Decisions

Intentionally deferred implementation decisions — not invented uncertainty, each traceable to a specific gap identified while writing this document:

1. **`User` role exclusivity** (§4, `User`) — `DOMAIN_MODEL.md`'s own unresolved Open Question #1. This document models it in the least-foreclosing way available, but the actual business answer is still owed.
2. **`WalletTransactionCause` enum completeness** (§4, `Wallet Transaction`) — `DOMAIN_MODEL.md` gives only illustrative examples, not an exhaustive list.
3. **Polymorphic reference mechanism** for `Wallet Transaction`'s and `Notification`'s causing-event reference, and `Support Ticket`'s financial-resolution reference (§4) — typed reference table vs. nullable per-type foreign keys vs. a generic (type, id) pair — a real implementation choice, not decided here.
4. **`Booking`'s and `Review`'s denormalized Provider reference** (§4) — flagged as a likely-necessary query convenience, not confirmed as required; should be validated against actual query patterns during implementation, not assumed.
5. **`Rating`'s numeric range** (§4) — never explicitly stated as a specific scale (e.g. 1–5) anywhere in `DOMAIN_MODEL.md`.
6. **`Staff` role-assignment mechanism** (§4) — multi-value field vs. join table, given one Staff member may hold multiple roles.
7. **Composite index selection** (§7) — candidates named, final selection deferred to observed query patterns.
8. **Search index type** for bilingual Service/Experience content (§7) — deferred to `LOCALIZATION.md` §9's normalization requirements being implemented.
9. **Translation storage mechanism** (§8) — `DATABASE_DESIGN.md` §20's own still-open item, not re-decided here.

---

## Related Documents
- `DOMAIN_MODEL.md` — the entities, relationships, and invariants this document translates, unchanged
- `DATABASE_DESIGN.md` §4–§9, §12, §15–§20 — the data-architecture rules this document implements at the model level, and whose §20 Open Decision #7 this document resolves (§4, Vehicle/Asset and Service/Experience inheritance)
- `SYSTEM_ARCHITECTURE.md` §4–§8 — the module boundaries this schema respects
- `ADR-0006-database-baseline.md` — UUID v7, UTC time, Decimal money, Currency pairs, binding on every model
- `LOCALIZATION.md` §8, `ACCESSIBILITY.md` — governing §8 in full
- `SECURITY.md` §5, §9 — data classification and audit requirements this document's Audit Fields (§9) implement
- `AI_STRATEGY.md`, `AI_AGENTS.md`, `ADR-0008-ai-agent-boundaries.md` — governing §10 in full
- `API_CONTRACTS.md` §4 — the resource ownership this document's models were checked against in §15

## Open Questions
1. `DOMAIN_MODEL.md`'s Open Question #1 (User role exclusivity) blocks a fully confident answer for §4's `User` model — should this be resolved in `DOMAIN_MODEL.md` first, with this document revised afterward, or can implementation proceed with the least-foreclosing structure this document already specifies? Flagged for a decision, not made unilaterally here.
2. Should `ReviewModerationState`'s undefined policy (§4, §6) block Review implementation specifically, or can the structural placeholder ship now with moderation logic added later without a schema change? Flagged, not decided here.

## Future ADR References
- None of this document's contents rise to the level of a new architectural decision — it is a translation, not a decision. No new ADR is anticipated as a direct result of this document.
- If Open Decision #1 (User role exclusivity) is resolved in a way that requires a structural change beyond what this document already accommodates, that resolution — recorded wherever `DOMAIN_MODEL.md`'s Open Question #1 is finally closed — may itself warrant an ADR, given how many other documents already depend on the Identity model.
