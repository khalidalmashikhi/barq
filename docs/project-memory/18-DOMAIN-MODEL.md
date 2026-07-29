# 18 — Domain Model (Enterprise Governance Layer)

**This is a project-memory-level document — it does not supersede or modify `docs/02-domain-architecture/DOMAIN_MODEL.md`, which remains Approved v1.0 — Locked and is the authoritative source for BARQ's current 15 Bounded Contexts (Identity, Customer, Provider, Booking, Operations, Pricing, Payments, Wallet, Contracts, Invoicing, Notifications, Tracking, Reviews, Administration, AI).** This file's purpose is to describe the *target* business domain implied by the 15 planned engines (`03-PRODUCT-REQUIREMENTS.md`), organized around the broader groupings that direction implies (Marketplace, Finance, Communication, Translation, Content, Support, Analytics), and to map each back to the existing Locked contexts honestly — noting where the mapping is clean and where it's an open reconciliation question, not silently deciding it.

Any actual renaming, merging, or splitting of Bounded Contexts is an architectural change requiring the ADR/RFC process (`docs/00-foundation/PROJECT_RULES.md`) — nothing here authorizes that; it is analysis and mapping only.

---

## Identity

**Purpose:** The root identity every person interacting with BARQ has, regardless of role(s).
**Maps to existing context:** Identity (unchanged).
**Core entities:** `User`, `AuthUser` (see `15-DATA-DICTIONARY.md`).
**Relationships:** One `User` optionally links to one `Customer`, `Provider`, `Staff`, `Admin` profile.
**Aggregate:** `User` is its own aggregate root — no other entity's consistency boundary includes it.
**Ownership:** Identity context (per existing `DOMAIN_MODEL.md`).
**Lifecycle:** Created on first successful OTP verification → linked to `AuthUser` → may gain one or more profile extensions over time. Never deleted (no hard-delete path exists for `User`).
**Status:** Fully real.

## Provider

**Purpose:** A registered business or individual offering services on BARQ.
**Maps to existing context:** Provider (unchanged in concept; extended in target state — see `05-PROVIDER-EXPERIENCE.md`).
**Core entities:** `Provider`, `Driver`, `Guide`, `Asset`/`Vehicle`, (target: `ProviderProfile`, `Document`) — see `15-DATA-DICTIONARY.md`.
**Relationships:** `Provider` owns `Driver`/`Guide`/`Asset` (inventory), `Service` (offerings), `Commission` (financial terms).
**Aggregate:** `Provider` is the aggregate root for its own inventory (Driver/Guide/Asset) — these are never modified except through their owning `Provider`'s own actions.
**Ownership:** Provider context.
**Lifecycle:** `APPLIED → UNDER_REVIEW → APPROVED → (SUSPENDED | DEACTIVATED)`. Target: individual/commercial branching at application time (see `16-BUSINESS-RULES.md` BR-011).
**Status:** Real but minimal (`01-CURRENT-STATE.md`).

## Marketplace

**Purpose:** The browsable, bookable catalog of categorized services tourists discover.
**Maps to existing context:** **Resolved (Phase 1.1) — no longer open.** Formally added as Bounded Context #16 to the Locked `docs/02-domain-architecture/DOMAIN_MODEL.md` via `ADR-0013-marketplace-bounded-context.md`. `Service`/`Experience`/`Availability` remain owned by Provider; Marketplace owns `Category`/`SubCategory` only.
**Core entities:** `Category`, `SubCategory` (real, Phase 1.1); `Service`, `Experience`, `Availability` remain Provider-owned, referenced but not owned here — see `15-DATA-DICTIONARY.md`.
**Relationships:** `SubCategory` belongs to exactly one `Category`. `Service` does **not** yet belong to a `Category` — that assignment is a Provider-facing change explicitly deferred past Phase 1.1.
**Aggregate:** `Category` is the aggregate root for its own `SubCategory` rows.
**Ownership:** Marketplace owns `Category`/`SubCategory` outright (Phase 1.1). `Service` ownership by `Provider` is unchanged, per `ADR-0013`'s explicit "Does Not Own" boundary.
**Lifecycle:** `Category`/`SubCategory`: visibility lifecycle per BR-004 (`PUBLIC`/`HIDDEN`/`LINK_ONLY`/`INVITE_ONLY`/`SCHEDULED`/`ARCHIVED`), enforced by `category-visibility-policy.ts`. `Service`: unchanged, `DRAFT → PUBLISHED → PAUSED → ARCHIVED`.
**Status:** Category/SubCategory real (Phase 1.1, backend only — no admin UI yet, that's Phase 1.2). Service/Availability real and mature, unchanged by this phase.

## Booking

**Purpose:** A customer's reservation against a Service.
**Maps to existing context:** Booking (unchanged) — the single most mature context in the system.
**Core entities:** `Booking`, `BookingStatusEvent`, `Journey`, `Route` — see `15-DATA-DICTIONARY.md`.
**Relationships:** Belongs to `Customer`, `Service`, `Provider`; owns its own status-event history.
**Aggregate:** `Booking` is the aggregate root; `BookingStatusEvent` rows are append-only children never modified independently.
**Ownership:** Booking context.
**Lifecycle:** `CREATED → PENDING_PROVIDER → (CONFIRMED | REJECTED | CANCELLED | EXPIRED) → IN_PROGRESS → COMPLETED`, plus `DISPUTED` — fully documented in `docs/08-bookings/BOOKING_LIFECYCLE.md`.
**Status:** Fully real, extensively tested.

## Finance

**Purpose:** Money movement, commission, and payout tracking.
**Maps to existing context:** Consolidates the Locked model's Pricing, Payments, Wallet, and Invoicing contexts under one grouping, matching the product direction's "Financial and Commission Engine" framing. **Whether this consolidation should become the real Bounded Context structure (replacing 4 contexts with 1) or stay as 4 separate contexts under a shared "Finance" umbrella label is an open question** — not decided here.
**Core entities:** `Price`, `Commission`, `Payment`, `Invoice`, `Wallet`, `WalletTransaction`, (target: `Settlement`) — see `15-DATA-DICTIONARY.md`.
**Relationships:** `Booking` snapshots `Price`+`Commission` at confirmation; `Payment` relates one-to-one to `Booking`; `WalletTransaction` is caused by `Booking`/`Payment`/`Commission`.
**Aggregate:** `Wallet` is the aggregate root for its own `WalletTransaction` history (never modified directly, only derived from transactions — per the existing Locked ownership rule in `IDENTITY_AND_ACCESS.md` §7).
**Ownership:** Currently Pricing/Payments/Wallet/Invoicing contexts (Locked model); target grouping per `08-PRICING-COMMISSIONS.md`.
**Lifecycle:** `Payment`: `INITIATED → CAPTURED → (REFUNDED_PARTIAL | REFUNDED_FULL | FAILED)`. Target: full Settlement lifecycle, not yet modeled.
**Status:** Partial — see `08-PRICING-COMMISSIONS.md` for the exact gap (no discount/tax/settlement fields).

## Communication

**Purpose:** All customer↔provider and customer/provider↔BARQ contact, mediated by BARQ.
**Maps to existing context:** Notifications (Locked) covers only the one-way, system-generated half. Two-way messaging and support have no existing context — **this is a genuinely new Bounded Context the product direction requires**, not currently named in the Locked `DOMAIN_MODEL.md`.
**Core entities:** `Notification` (real); target: `Conversation`, `Message`, `SupportTicket` (schema-only today) — see `15-DATA-DICTIONARY.md`.
**Relationships:** Target: `Conversation` links two `User`s, optionally a `Booking`; `SupportTicket` relates to `Customer`/`Provider`/`Booking`/`Payment`.
**Aggregate:** `Notification` is its own aggregate root today. Target: `Conversation` would be the aggregate root for its `Message` children.
**Ownership:** Notifications context (existing, for the one-way half) — a new context is needed for the two-way half; not named in the Locked model yet.
**Lifecycle:** `Notification`: created → delivered/failed → read. Target: `SupportTicket`: `OPENED → IN_PROGRESS → (ESCALATED) → RESOLVED → CLOSED`.
**Status:** Notification real; Conversation/Message don't exist; SupportTicket is schema-only. See `10-COMMUNICATION-POLICY.md`, `06-TOURIST-EXPERIENCE.md`.

## Translation

**Purpose:** Making UI and business content available in all 8 supported languages.
**Maps to existing context:** Not a named Bounded Context in the Locked model at all — i18n is treated as a cross-cutting architectural concern (ADR-0005, ADR-0010), not a domain context with its own entities. **Whether Translation deserves to become a real Bounded Context (once an AI-assisted workflow with review states exists) or remains purely cross-cutting is an open question.**
**Core entities:** Today: none (static files). Target: some form of `TranslationReview`/`TranslationTask` entity, per `09-TRANSLATION-I18N.md`'s open design questions.
**Relationships:** N/A today.
**Aggregate:** N/A today.
**Ownership:** N/A today — would need a home once entities exist.
**Lifecycle:** N/A today; target: draft → (AI-proposed) → reviewed → approved, exact model undecided.
**Status:** Does not exist as a domain concept with entities — purely a static-file, cross-cutting concern today.

## Administration

**Purpose:** Platform configuration and approval authority.
**Maps to existing context:** Administration (unchanged).
**Core entities:** `Admin`, `Staff`, (target: `FeatureFlag`) — see `15-DATA-DICTIONARY.md`.
**Relationships:** `Admin` approves `Provider`; `Staff` holds one or more `StaffRole` (`OPERATIONS`/`SUPPORT`/`FINANCE` — already defined in schema, see `20-PERMISSION-MATRIX.md`).
**Aggregate:** `Admin`/`Staff` are independent aggregate roots (identity-adjacent, not owning other domain data directly).
**Ownership:** Administration context.
**Lifecycle:** N/A (Admin/Staff accounts are provisioned, not state-machined in the way Booking/Provider are).
**Status:** Minimal real implementation (`04-ADMIN-PLATFORM.md`) — one action (approve-provider) exists; `StaffRole` enum exists in schema but nothing differentiates Operations/Support/Finance staff in any real feature yet.

## Content

**Purpose:** Homepage sections and other CMS-managed presentation content.
**Maps to existing context:** Not named in the Locked model — **genuinely new**, matching the product direction's "CMS and Dynamic Homepage" engine.
**Core entities:** `HomepageSection` — **corrected 2026-07-27 (Growth Foundations phase): this now exists**, see `15-DATA-DICTIONARY.md`.
**Relationships:** None today — governs which registry-defined sections render and in what order, not a reference to the content itself.
**Aggregate:** `HomepageSection` (ordering/visibility only).
**Ownership:** Admin-managed via `/admin/homepage-sections`.
**Lifecycle:** N/A — a plain `visible` boolean + `sortOrder` integer, no state machine.
**Status:** Ordering/visibility is a real, manageable entity with admin CRUD, and the public homepage genuinely reads it (gated by the `homepage_dynamic_sections` feature flag). 3 of 13 registry sections (Featured Experiences, Providers, Stats) read real content (Service/Provider/count queries embedded directly in component code); the rest are static JSX regardless of the flag. Editing a section's own content from the admin UI remains target-state.

## Support

**Purpose:** Customer/provider assistance requests — the "ساعدني" channel.
**Maps to existing context:** The Locked `DOMAIN_MODEL.md` itself flags this exact question unresolved in its own Open Questions (#2): *"Support Ticket was placed under Operations context per the earlier gap analysis's intent, but Dispute handling touches Payments/Wallet directly — should Disputes be a distinct sub-concept inside Operations, or does this warrant re-examining whether Operations and a future 'Support' context should split?"* This document does not resolve that question — it is restated here, not answered, because the product direction's explicit "Support / ساعدني Ticket Center" engine makes the question concrete rather than hypothetical.
**Core entities:** `SupportTicket` (schema-only) — see `15-DATA-DICTIONARY.md`.
**Relationships:** Relates to `Customer`, `Provider`, `Booking`, `Payment`.
**Aggregate:** `SupportTicket` would be its own aggregate root.
**Ownership:** Currently implicitly Operations (per the Locked model's placement); target may split into its own context.
**Lifecycle:** `OPENED → IN_PROGRESS → (ESCALATED) → RESOLVED → CLOSED`.
**Status:** Schema-only, zero application code.

## Analytics

**Purpose:** Business intelligence and reporting for admin/provider decision-making.
**Maps to existing context:** Not named anywhere in the Locked model, `03-PRODUCT-REQUIREMENTS.md`'s 15-engine catalog, or any prior architecture document. **Genuinely new, introduced only by the 9-phase roadmap's Phase 9** (`../plans/ROADMAP.md`).
**Core entities:** None exist or are even scoped yet.
**Relationships:** Unscoped.
**Aggregate:** Unscoped.
**Ownership:** Unscoped.
**Lifecycle:** Unscoped.
**Status:** Does not exist; needs product scoping before any of the above can be answered. See `13-OPEN-QUESTIONS.md`.

## AI

**Purpose:** AI-assisted capabilities across the platform, under strict human-in-the-loop governance.
**Maps to existing context:** AI (unchanged).
**Core entities:** `AIAgent` — see `15-DATA-DICTIONARY.md`.
**Relationships:** By design, `AIAgent` holds no FK relationship to any other domain table (`ADR-0008` point 3).
**Aggregate:** `AIAgent` is its own aggregate root, deliberately isolated.
**Ownership:** AI context.
**Lifecycle:** `DEFINED → DEPLOYED (Active) → (SUSPENDED | RETIRED)` per `docs/02-domain-architecture/DOMAIN_MODEL.md`'s own AI Agent entity spec.
**Status:** Schema-only, zero application code, governed by ADR-0008's 17 permanent boundaries (see `11-SECURITY-POLICY.md`, BR-020).

---

## Reconciliation summary

| New grouping (this document) | Existing Locked context(s) it draws from | Reconciliation status |
|---|---|---|
| Identity | Identity | Clean 1:1 |
| Provider | Provider | Clean 1:1, extended in target state |
| Marketplace | New Bounded Context #16 (`Category`/`SubCategory`); `Service`/`Experience`/`Availability` remain Provider-owned | **Resolved — `ADR-0013` (Phase 1.1)** |
| Booking | Booking | Clean 1:1 |
| Finance | Pricing, Payments, Wallet, Invoicing | **Open — 4-into-1 consolidation not decided** |
| Communication | Notifications (partial) | **Open — two-way messaging/support has no existing context** |
| Translation | (none — cross-cutting concern) | **Open — may not need to become a context at all** |
| Administration | Administration | Clean 1:1 |
| Content | (none) | **New — no existing context** |
| Support | Operations (per Locked model's own unresolved Open Question #2) | **Open — restates an already-flagged Locked-doc question** |
| Analytics | (none) | **New — entirely unscoped** |
| AI | AI | Clean 1:1 |

Formalizing any of the "Open" rows above into a real Bounded Context change requires the ADR/RFC process — this document only surfaces the mapping question, per this phase's documentation-only scope.
