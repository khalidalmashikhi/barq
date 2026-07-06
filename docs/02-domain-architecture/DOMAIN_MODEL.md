# BARQ Domain Model

- **Purpose:** Define BARQ's business domain — the Bounded Contexts, core entities, their relationships, responsibilities, invariants, and the business events that occur between them. This document is the conceptual foundation that `DATABASE_DESIGN.md`, `API_STANDARDS.md`/`REST_API.md`, `AI_AGENTS.md`, every platform-capability document, and `SYSTEM_ARCHITECTURE.md` must build from.
- **Scope:** Business entities, Bounded Contexts, entity relationships, business invariants (rules that must always hold true), and business-level domain events.
- **Out of Scope:** Database schema/tables (owned by `DATABASE_DESIGN.md`), API contracts (owned by `API_STANDARDS.md`/`REST_API.md`), system/module architecture (owned by `SYSTEM_ARCHITECTURE.md`), UI/UX (owned by `docs/05-ux/` and `DESIGN_SYSTEM.md`), and implementation of any kind. This document describes the business, not the software that will run it.
- **Dependencies:** `GLOSSARY.md` (all entity and context names below use Glossary-canonical terms exactly), `PROJECT_MANIFEST.md`, `ARCHITECTURE_PRINCIPLES.md` (Principle 4, Domain-Driven Design — this document is that principle's first concrete output), `ADR-0002-modular-monolith.md` (Bounded Contexts here are expected to map to modules, decided formally in `SYSTEM_ARCHITECTURE.md`).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## A Note on Single Source of Truth

`GLOSSARY.md` remains the single source of truth for **terminology** — what a word means, in English and Arabic. This document is the single source of truth for **business structure** — how those concepts relate, who owns what, and what must always be true. The two are not in competition: this document uses only Glossary-approved terms, and does not redefine any term the Glossary already owns. Where this document introduces a distinction the Glossary doesn't yet capture (for example, "Guide" as an entity name vs. the requested label "Tour Guide"), the Glossary's term wins and is used here — flagged explicitly below where relevant, not silently resolved.

**Terminology note:** The request framing this document used "Provider" and "Tour Guide." Per `GLOSSARY.md`, the canonical terms are **Service Provider** and **Guide**. This document uses the canonical Glossary terms throughout; "Provider" is used only as informal shorthand for "Service Provider" where a Bounded Context name benefits from brevity (consistent with common DDD naming practice), never as a redefinition.

---

## 1. Bounded Contexts

### 1. Identity

- **Purpose:** Establish who is acting on the platform and verify that they are who they claim to be.
- **Responsibilities:** Phone-based OTP verification, credential/session management, role assignment (Customer, Service Provider, Driver, Guide, Staff, Admin), access control.
- **Owns:** `User` (the base identity record).
- **Does Not Own:** Business-specific profile data (Customer preferences, Service Provider business details) — those belong to their respective contexts, which extend `User` rather than duplicate it.
- **Collaborates With:** Customer, Provider, Administration (every other context depends on Identity to know who is acting).

### 2. Customer

- **Purpose:** Represent the traveler booking and consuming services.
- **Responsibilities:** Customer profile and preferences, Staff-Assisted Booking eligibility (a Customer record can exist before the person ever opens the app, per `GLOSSARY.md` term 12).
- **Owns:** `Customer`.
- **Does Not Own:** Bookings themselves (Booking context), payment instruments processing (Payments context) — Customer is the *who*, not the *what happened*.
- **Collaborates With:** Identity, Booking, Wallet, Notifications, Reviews.

### 3. Provider (Service Provider)

- **Purpose:** Represent the businesses and individuals offering bookable services, and the resources (people, vehicles, assets) they operate.
- **Responsibilities:** Service Provider onboarding and profile, Driver and Guide association, Vehicle/Asset registration, Service and Experience listings, Availability management.
- **Owns:** `Provider` (Service Provider), `Driver`, `Guide`, `Vehicle`, `Asset`, `Service`, `Experience`, `Availability`.
- **Does Not Own:** The approval *decision* authority (Administration context decides; Provider context reflects the resulting state), Booking records, Pricing/Commission rules (Pricing context; Provider only sets its own price within those rules).
- **Collaborates With:** Administration (approval), Booking (fulfillment), Pricing (price-setting within commission rules), Wallet (payouts).

### 4. Booking

- **Purpose:** Represent the commercial commitment between a Customer and a Service Provider for a Service or Experience.
- **Responsibilities:** Booking creation (including Staff-Assisted Booking), confirmation, cancellation, assignment of Driver/Guide/Vehicle to a confirmed Booking.
- **Owns:** `Booking`.
- **Does Not Own:** Live execution/movement once underway (Tracking context owns `Journey`/`Route`), pricing calculation logic (Pricing context; Booking consumes the result), payment capture (Payments context).
- **Collaborates With:** Customer, Provider, Pricing, Tracking, Notifications, Payments.

### 5. Operations

- **Purpose:** Provide real-time oversight, dispatch support, and incident/support handling across active Bookings.
- **Responsibilities:** Real-time monitoring (feeding the Operations Center capability), Support Ticket triage, coordination during service disruptions.
- **Owns:** `Support Ticket`.
- **Does Not Own:** Booking or Journey data structure itself (it observes and acts on it via collaboration, not ownership), Dispute resolution outcomes affecting money (Payments/Wallet own the financial consequence).
- **Collaborates With:** Booking, Tracking, Provider, Customer, Administration.

### 6. Pricing

- **Purpose:** Define how much a Booking costs and how much BARQ earns from it.
- **Responsibilities:** Provider-Set Pricing rules, Commission Tier definition and assignment (12%/10%/8%), commission calculation.
- **Owns:** `Price`, `Commission`.
- **Does Not Own:** Payment capture or settlement (Payments/Wallet), the Service/Experience listing itself (Provider context).
- **Collaborates With:** Provider, Booking, Payments, Wallet, Invoicing.

### 7. Payments

- **Purpose:** Represent money moving into BARQ from Customers for Bookings.
- **Responsibilities:** Payment capture, refund initiation, payment status tracking.
- **Owns:** `Payment`.
- **Does Not Own:** Provider payout logic (Wallet context), invoice document generation (Invoicing context), pricing/commission calculation (Pricing context; Payments consumes the result).
- **Collaborates With:** Booking, Pricing, Wallet, Invoicing, Customer.

### 8. Wallet

- **Purpose:** Represent BARQ-managed balances — what is owed to or held for Service Providers (and optionally Customers).
- **Responsibilities:** Balance maintenance, Payout processing, Wallet Transaction ledger integrity.
- **Owns:** `Wallet`, `Wallet Transaction`.
- **Does Not Own:** The originating Payment event (Payments context) or Commission calculation (Pricing context) — Wallet records the *consequence* of those, it doesn't decide the amounts itself.
- **Collaborates With:** Payments, Pricing, Provider, Invoicing.

### 9. Contracts

- **Purpose:** Represent legally binding agreements between BARQ and a Service Provider or Customer.
- **Responsibilities:** Contract creation, versioning, signature status.
- **Owns:** `Contract`.
- **Does Not Own:** Invoices (Invoicing context — a Contract is an agreement, an Invoice is a transactional record; per `GLOSSARY.md` term 24 these are deliberately distinct).
- **Collaborates With:** Provider, Customer, Administration.

### 10. Invoicing

- **Purpose:** Represent the legally formatted transactional record of a billable Booking.
- **Responsibilities:** Invoice generation, numbering sequence integrity, bilingual invoice formatting.
- **Owns:** `Invoice`.
- **Does Not Own:** Payment capture itself (Payments context; Invoicing reflects a completed transaction, it doesn't process one), Contracts (Contracts context).
- **Collaborates With:** Booking, Payments, Pricing, Customer, Provider.

### 11. Notifications

- **Purpose:** Deliver timely information to Customers, Providers, Drivers, Guides, and Staff about events relevant to them.
- **Responsibilities:** Notification composition, delivery channel selection (WhatsApp primary, with fallback), delivery status tracking.
- **Owns:** `Notification`.
- **Does Not Own:** The business event that triggers a notification (every other context owns its own events; Notifications reacts to them) — see Domain Events, §3.
- **Collaborates With:** Every other context, as a downstream reactor to domain events.

### 12. Tracking

- **Purpose:** Represent the live execution and movement of a confirmed Booking.
- **Responsibilities:** Journey lifecycle (start, in-progress, completion), Route recording, live location sharing.
- **Owns:** `Journey`, `Route`.
- **Does Not Own:** The Booking commercial record itself (Booking context) — Tracking owns what happens *during* fulfillment, not the commitment that led to it.
- **Collaborates With:** Booking, Provider (Driver/Guide/Vehicle assignment), Operations, Customer.

### 13. Reviews

- **Purpose:** Capture Customer feedback on completed Bookings.
- **Responsibilities:** Review submission, Rating aggregation.
- **Owns:** `Review`, `Rating`.
- **Does Not Own:** The Booking or Journey being reviewed (Booking/Tracking contexts) — Reviews references them, it doesn't manage their lifecycle.
- **Collaborates With:** Booking, Customer, Provider.

### 14. AI

- **Purpose:** Provide autonomous or semi-autonomous assistance across the platform within explicitly documented boundaries.
- **Responsibilities:** AI Agent behavior definition, recommendation generation, natural-language interaction in Arabic and English.
- **Owns:** `AI Agent`.
- **Does Not Own:** Any business decision an AI Agent merely assists with (e.g. an AI Agent may recommend a Commission Tier change, but Administration owns the actual decision and its authority) — this boundary is deliberate and enforced by `PROJECT_MANIFEST.md` §7 and `ARCHITECTURE_PRINCIPLES.md` Principle 23 (Human-in-the-Loop for High-Risk Actions).
- **Collaborates With:** Every context an agent is authorized to act within, always subject to the guardrails defined in `AI_GUARDRAILS.md` (not yet written).

### 15. Administration

- **Purpose:** Represent BARQ's own internal operators and the configuration/approval authority they exercise over the platform.
- **Responsibilities:** Staff and Admin account management, Service Provider approval decisions, platform-level configuration (e.g. Commission Tier policy).
- **Owns:** `Staff`, `Admin`.
- **Does Not Own:** The Service Provider entity's day-to-day data (Provider context) — Administration decides; Provider context reflects and operates on the decision.
- **Collaborates With:** Provider, Identity, Operations, Pricing.

---

## 2. Core Domain Entities

### User

- **Description:** The base identity record for anyone who can authenticate with BARQ — the foundation that Customer, Provider, Staff, and Admin profiles extend.
- **Responsibilities:** Hold verified phone number, credentials/session state, and assigned role(s).
- **Lifecycle:** Created (via OTP verification, or by Staff on a Customer's behalf per Staff-Assisted Booking) → Verified → Active → (Suspended / Deactivated).
- **Relationships:** One `User` may correspond to exactly one `Customer`, one `Provider`-side profile (if applicable), one `Staff`, or one `Admin` — a single person does not hold multiple conflicting roles without explicit design (flagged in Open Questions).
- **Business Invariants:** A `User` must have a verified phone number before being marked Active. A `User` created via Staff-Assisted Booking is provisionally Active without the person having authenticated themselves yet — this is an intentional exception, not a violation, and must be clearly represented as such.

### Customer

- **Description:** A traveler who books, or is booked for, tourism services through BARQ.
- **Responsibilities:** Hold booking history, preferences, and Wallet reference (if applicable).
- **Lifecycle:** Created (self-registered or Staff-created by phone number) → Active → (Dormant / Deactivated).
- **Relationships:** One `Customer` has many `Booking`s, many `Review`s, at most one `Wallet`.
- **Business Invariants:** A `Customer` must exist (even minimally, phone-number-only) before a `Booking` can reference them — no anonymous Bookings.

### Provider (Service Provider)

- **Description:** A business or individual entity offering bookable `Service`s or `Experience`s.
- **Responsibilities:** Maintain its own `Service`/`Experience` listings, `Availability`, associated `Driver`s/`Guide`s/`Vehicle`s/`Asset`s, and pricing within commission rules.
- **Lifecycle:** Applied → Under Review → Approved (Active) → (Suspended / Deactivated). Approval/Suspension is an Administration-context decision reflected here.
- **Relationships:** One `Provider` has many `Driver`s, `Guide`s, `Vehicle`s, `Asset`s, `Service`s, `Experience`s; is assigned exactly one `Commission` tier at a time; has one `Wallet`.
- **Business Invariants:** A `Provider` must be Approved before any of its `Service`s/`Experience`s can be booked. A `Provider` always has exactly one active `Commission` tier — never zero, never more than one simultaneously.

### Driver

- **Description:** An individual who operates a `Vehicle` on behalf of a `Provider` to fulfill a `Booking`.
- **Responsibilities:** Be assignable to a `Booking`/`Journey`; hold license/eligibility status.
- **Lifecycle:** Registered (by Provider) → Verified → Active → (Suspended / Deactivated).
- **Relationships:** Belongs to exactly one `Provider`. May be assigned to many `Booking`s over time, one at a time currently active.
- **Business Invariants:** A `Driver` cannot exist without an owning `Provider` — a `Driver` is never itself a `Provider` (per `GLOSSARY.md` term 3).

### Guide

- **Description:** An individual who delivers a guided tourism `Experience` on behalf of a `Provider`.
- **Responsibilities:** Be assignable to a `Booking`/`Journey` requiring guiding; hold qualification/eligibility status.
- **Lifecycle:** Registered → Verified → Active → (Suspended / Deactivated).
- **Relationships:** Belongs to exactly one `Provider`. May be assigned to many `Booking`s, one at a time currently active.
- **Business Invariants:** A `Booking` may require a `Guide`, a `Driver`, both, or neither — the two roles are independent, per `GLOSSARY.md` term 4.

### Vehicle

- **Description:** A specific type of `Asset` used for transport-based `Service`s.
- **Responsibilities:** Represent registration details and eligibility for assignment to a `Booking`.
- **Lifecycle:** Registered → Verified → Active → (Under Maintenance / Deactivated).
- **Relationships:** Is a specialization of `Asset`; belongs to exactly one `Provider`; may be assigned to many `Booking`s over time, one at a time currently active.
- **Business Invariants:** A `Vehicle` must be Verified before assignment to a `Booking`.

### Asset

- **Description:** Any physical resource a `Provider` registers that can be assigned to a `Booking` — a deliberately generic concept to allow future asset types beyond vehicles.
- **Responsibilities:** Represent ownership and eligibility state, generically across asset types.
- **Lifecycle:** Registered → Verified → Active → (Under Maintenance / Deactivated).
- **Relationships:** Belongs to exactly one `Provider`; `Vehicle` is its current only specialization.
- **Business Invariants:** Every `Asset` belongs to exactly one `Provider` — no shared or ownerless Assets.

### Service

- **Description:** A bookable offering listed by a `Provider`.
- **Responsibilities:** Define what is being offered, and reference the `Availability` and `Price` that apply to it.
- **Lifecycle:** Draft → Published (Active) → (Paused / Archived).
- **Relationships:** Belongs to exactly one `Provider`; has one current `Price`; has an `Availability` schedule; `Experience` is its current only specialization.
- **Business Invariants:** A `Service` must have a `Price` before it can be Published.

### Experience

- **Description:** A specialized `Service` representing a curated tourism experience, typically involving a `Guide`.
- **Responsibilities:** Same as `Service`, with the added expectation of guiding/experiential content.
- **Lifecycle:** Same as `Service`.
- **Relationships:** Is a specialization of `Service`.
- **Business Invariants:** Inherits all `Service` invariants; an `Experience` requiring a `Guide` cannot be fulfilled without one assigned at Booking confirmation.

### Booking

- **Description:** The confirmed commercial commitment between a `Customer` and a `Provider` for a `Service`/`Experience` at a specific time.
- **Responsibilities:** Represent the single canonical record of what was booked, by whom, for whom, and its current state.
- **Lifecycle:** Created → Confirmed → (Assigned Driver/Guide/Vehicle) → In Progress → Completed → (Cancelled / Disputed at any point before Completed).
- **Relationships:** Belongs to one `Customer`; references one `Service`/`Experience` and its owning `Provider`; has one `Price` snapshot at time of booking; produces one `Journey` upon confirmation; may produce one `Invoice`, one `Payment`, one `Review`.
- **Business Invariants:** A `Booking` cannot be Confirmed without an available `Service`/`Experience` slot per `Availability`. A `Booking`'s `Price` is fixed at confirmation time and does not change if the `Provider`'s listed price later changes — the Customer's commitment is to the price they booked at.

### Journey

- **Description:** The live execution of a confirmed `Booking` — the movement/delivery of the service in real time.
- **Responsibilities:** Track start, progress, and completion of service delivery.
- **Lifecycle:** Not Started → Started → In Progress → Completed (or Interrupted).
- **Relationships:** Belongs to exactly one `Booking`; has one or more `Route` recordings.
- **Business Invariants:** A `Journey` cannot Start before its `Booking` is Confirmed and has an assigned `Driver`/`Guide`/`Vehicle` as required by the `Service`.

### Route

- **Description:** The recorded or planned path associated with a `Journey`.
- **Responsibilities:** Represent live location history for Live Tracking.
- **Lifecycle:** Planned → Recording (during active `Journey`) → Finalized.
- **Relationships:** Belongs to exactly one `Journey`.
- **Business Invariants:** A `Route`'s recorded data is immutable once the `Journey` is Completed — it becomes historical record, not editable.

### Availability

- **Description:** The schedule defining when a `Service`/`Experience` can be booked.
- **Responsibilities:** Represent open/blocked time slots.
- **Lifecycle:** Defined by `Provider` → continuously updated as `Booking`s consume slots.
- **Relationships:** Belongs to exactly one `Service`.
- **Business Invariants:** A `Booking` may only be Confirmed against a currently open `Availability` slot; confirming consumes that slot.

### Price

- **Description:** The amount a `Provider` charges for a `Service`/`Experience`, per Provider-Set Pricing.
- **Responsibilities:** Represent the current chargeable amount and its history.
- **Lifecycle:** Set by `Provider` → Active → Superseded (by a new `Price`, when changed).
- **Relationships:** Belongs to exactly one `Service`; referenced (snapshotted) by every `Booking` made against that `Service`.
- **Business Invariants:** Only the `Provider` sets `Price` — BARQ does not set or override it (Provider-Set Pricing, `GLOSSARY.md` term 20), though `Commission` is calculated against it independently of the Provider's control.

### Commission

- **Description:** The percentage of a `Booking`'s value retained by BARQ.
- **Responsibilities:** Represent the currently assigned tier (12%/10%/8%) for a `Provider` and the calculated amount for a specific `Booking`.
- **Lifecycle:** Assigned (at Provider approval or tier change) → Active → Superseded (on tier change).
- **Relationships:** Belongs to exactly one `Provider` at a time; calculated per `Booking`.
- **Business Invariants:** Every `Provider` has exactly one active `Commission` tier at any time. A `Booking`'s `Commission` amount is fixed at confirmation time, consistent with `Price`'s invariant above.

### Wallet

- **Description:** A BARQ-managed balance representing funds owed to or held for a `Provider` (or optionally a `Customer`).
- **Responsibilities:** Maintain current balance as the sum of its `Wallet Transaction`s.
- **Lifecycle:** Created (with owning `Provider`/`Customer`) → Active (continuously updated) — never deleted, only ever zero-balanced.
- **Relationships:** Belongs to exactly one `Provider` or `Customer`; has many `Wallet Transaction`s.
- **Business Invariants:** A `Wallet`'s balance must always equal the sum of its `Wallet Transaction`s — it is never set directly, only derived.

### Wallet Transaction

- **Description:** A single, immutable ledger entry affecting a `Wallet`'s balance.
- **Responsibilities:** Record one credit or debit with its business cause (e.g. Commission deduction, Payout).
- **Lifecycle:** Created → Immutable (never edited or deleted; corrections are new offsetting entries).
- **Relationships:** Belongs to exactly one `Wallet`; typically references the `Booking`, `Payment`, or `Commission` that caused it.
- **Business Invariants:** A `Wallet Transaction` is never modified or deleted after creation — the ledger is append-only, consistent with `Route`'s immutability pattern.

### Payment

- **Description:** Money captured from a `Customer` for a `Booking`.
- **Responsibilities:** Represent capture status, amount, and refund state.
- **Lifecycle:** Initiated → Captured → (Refunded, fully or partially) — or Failed.
- **Relationships:** Belongs to exactly one `Booking`; triggers `Wallet Transaction`(s) for the relevant `Provider`.
- **Business Invariants:** A `Payment`'s captured amount must equal the `Booking`'s fixed `Price` at confirmation — no silent discrepancy.

### Invoice

- **Description:** The legally formatted transactional record of a billable `Booking`.
- **Responsibilities:** Represent a bilingual, sequentially numbered billing document.
- **Lifecycle:** Generated (on `Booking` completion or per policy) → Issued → (Superseded by a Credit Note, if ever corrected — never edited in place).
- **Relationships:** Belongs to exactly one `Booking`.
- **Business Invariants:** `Invoice` numbering is sequential and gapless — an `Invoice` is never deleted or renumbered after issuance.

### Contract

- **Description:** A legally binding agreement between BARQ and a `Provider` or `Customer`.
- **Responsibilities:** Represent agreed terms and signature status.
- **Lifecycle:** Drafted → Sent → Signed → Active → (Superseded / Terminated).
- **Relationships:** Belongs to exactly one `Provider` or `Customer`.
- **Business Invariants:** A `Provider` cannot be Approved (see Provider lifecycle) without an Active `Contract` in place — this dependency must be respected even though Contracts and Administration are separate contexts.

### Notification

- **Description:** A message delivered to a `User` about an event relevant to them.
- **Responsibilities:** Represent content (bilingual), channel, and delivery status.
- **Lifecycle:** Composed → Sent → Delivered (or Failed) → (Fallback channel attempted, if Failed).
- **Relationships:** Belongs to exactly one `User`; typically caused by a domain event from another context (see §3).
- **Business Invariants:** A `Notification`'s content must be available in both Arabic and English before it can be Sent, per `ADR-0005`.

### Review

- **Description:** Customer feedback on a completed `Booking`.
- **Responsibilities:** Represent free-text feedback and reference to the `Booking`.
- **Lifecycle:** Submitted → Published (or Flagged/Removed per moderation policy, not yet defined).
- **Relationships:** Belongs to exactly one `Booking` and one `Customer`; has one `Rating`.
- **Business Invariants:** A `Review` can only be submitted for a `Booking` in Completed state — no reviewing a Booking that never happened or is still in progress.

### Rating

- **Description:** A numeric score accompanying a `Review`.
- **Responsibilities:** Represent the score and contribute to a `Provider`'s aggregate rating.
- **Lifecycle:** Submitted with its `Review` → Immutable thereafter (a changed opinion produces a new `Review`/`Rating`, not an edit — consistent with the immutability pattern elsewhere in this model).
- **Relationships:** Belongs to exactly one `Review`.
- **Business Invariants:** A `Rating` always accompanies exactly one `Review` — there is no standalone rating without feedback context.

### Support Ticket

- **Description:** A record of a Customer's or Provider's issue requiring Staff attention.
- **Responsibilities:** Represent issue state and resolution, including escalation to `Dispute` handling where money is involved.
- **Lifecycle:** Opened → In Progress → (Escalated) → Resolved (or Closed without resolution).
- **Relationships:** Typically references a `Booking`; may be raised by a `Customer` or a `Provider`.
- **Business Invariants:** A `Support Ticket` involving a refund claim cannot be Resolved without a corresponding `Payment`/`Wallet Transaction` outcome recorded — resolution and financial consequence must stay consistent.

### Staff

- **Description:** A BARQ-employed operations team member.
- **Responsibilities:** Create `Customer`s and `Booking`s on their behalf (Staff-Assisted Booking), triage `Support Ticket`s.
- **Lifecycle:** Onboarded → Active → (Deactivated).
- **Relationships:** Extends `User`; acts on behalf of `Customer`s without being one.
- **Business Invariants:** A `Staff` action taken on behalf of a `Customer` must be attributable to that `Staff` member in the Audit Log — anonymity is never permitted for Staff-assisted actions, per `GLOSSARY.md` term 27.

### Admin

- **Description:** A BARQ-employed role with configuration and oversight authority.
- **Responsibilities:** Approve/suspend `Provider`s, set `Commission` policy, platform configuration.
- **Lifecycle:** Onboarded → Active → (Deactivated).
- **Relationships:** Extends `User`.
- **Business Invariants:** Every `Admin` action affecting `Commission`, `Provider` approval, or platform configuration is recorded in the Audit Log — no silent configuration changes.

### AI Agent

- **Description:** An autonomous or semi-autonomous software component acting within defined boundaries on behalf of the platform, a `Customer`, or `Staff`.
- **Responsibilities:** Perform its documented function (e.g. recommendation) within its guardrails; operate bilingually.
- **Lifecycle:** Defined (specification approved) → Deployed (Active) → (Suspended / Retired).
- **Relationships:** May reference/act within any context it is explicitly authorized for; every high-risk action it takes references a `Staff`/`Admin` approval per Human-in-the-Loop.
- **Business Invariants:** An `AI Agent` never takes an action affecting money, trust, or personal data without a Human-in-the-Loop checkpoint, per `PROJECT_MANIFEST.md` §7 and `ARCHITECTURE_PRINCIPLES.md` Principle 23 — this is the single invariant every other AI-related document must uphold.

---

## 3. Domain Events

Business-level occurrences only — no technical/system events (those belong to `EVENTS.md`, not yet written, which will formalize these as the platform's actual event catalog).

**Identity**
- User Registered
- User Verified

**Provider**
- Provider Applied
- Provider Approved
- Provider Suspended
- Driver Registered
- Guide Registered
- Vehicle Registered

**Booking**
- Booking Created
- Booking Confirmed
- Booking Cancelled
- Booking Disputed

**Tracking**
- Journey Started
- Journey Completed
- Journey Interrupted

**Pricing**
- Price Set
- Commission Calculated
- Commission Tier Changed

**Payments**
- Payment Received
- Payment Failed
- Refund Issued

**Wallet**
- Wallet Transaction Recorded
- Payout Processed

**Contracts**
- Contract Sent
- Contract Signed

**Invoicing**
- Invoice Generated

**Notifications**
- Notification Sent
- Notification Delivery Failed

**Reviews**
- Review Submitted

**AI**
- AI Recommendation Generated
- AI Action Escalated for Human Review

**Administration**
- Admin Configuration Changed

---

## Related Documents
- `GLOSSARY.md` — terminology SSOT; every term used above is Glossary-canonical
- `PROJECT_MANIFEST.md`, `ARCHITECTURE_PRINCIPLES.md` — the philosophy and principles (especially Principle 4, DDD, and Principle 23, Human-in-the-Loop) this document operationalizes into concrete structure
- `ADR-0002-modular-monolith.md` — the 15 Bounded Contexts above are the expected candidate module boundaries; `SYSTEM_ARCHITECTURE.md` will confirm the actual mapping
- `ADR-0005-bilingual-architecture.md` — reflected in the `Notification` entity's invariant and throughout
- `DATABASE_DESIGN.md`, `API_STANDARDS.md`, `AI_AGENTS.md`, `EVENTS.md`, every platform-capability document *(not yet written)* — each must build on this document's entities and events rather than redefining them

## Open Questions
1. `User` role exclusivity (can one person hold Customer and Staff roles simultaneously, e.g. a Staff member who is also a personal Customer?) is flagged but not resolved above — needs a decision before `DATABASE_DESIGN.md` can model `User`-to-role relationships correctly.
2. `Support Ticket` was placed under Operations context per the earlier gap analysis's `CUSTOMER_SUPPORT_AND_DISPUTES.md` intent, but Dispute handling touches Payments/Wallet directly — should Disputes be a distinct sub-concept inside Operations, or does this warrant re-examining whether Operations and a future "Support" context should split? Flagging rather than deciding unilaterally.
3. `Review`/`Rating` moderation policy (flagging, removal) is referenced but not defined — likely belongs to a future `CUSTOMER_SUPPORT_AND_DISPUTES.md` or a dedicated moderation document.
4. Whether `Experience` and `Service` will remain a simple specialization or need distinct lifecycles as the product matures (e.g. Experiences requiring approval workflows Services don't) is left open for `PRODUCT_REQUIREMENTS.md` to inform.

## Future ADR References
- `SYSTEM_ARCHITECTURE.md`'s decision on how these 15 Bounded Contexts map to actual modules within the Modular Monolith is expected to produce a dedicated ADR.
- Any future change to a Bounded Context's ownership boundary (the "Owns"/"Does Not Own" split above) once this document reaches Locked status requires an ADR, not a silent edit.
