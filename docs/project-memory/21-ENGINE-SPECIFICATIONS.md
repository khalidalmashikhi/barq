# 21 — Engine Specifications (Enterprise Governance Layer)

Purpose/Responsibilities/Dependencies/Inputs/Outputs/Future extensions for every planned engine. **Naming reconciliation up front**: this document's requested 18-engine list splits two items the original 15-engine catalog (`03-PRODUCT-REQUIREMENTS.md`) kept combined — "CMS Engine" + "Homepage Engine" (originally one: "CMS and Dynamic Homepage," #9) and "Permission Engine" + "Audit Engine" (originally one: "Audit Trail and Permission Engine," #15). Both are documented here as the requested separate entries, cross-referenced to their shared origin — this is a documentation-level split for specification clarity, not a decision that they must ship as two separate technical systems; that remains open until each is actually scoped.

None of the specifications below authorize implementation — every engine remains "Not started" per `../plans/IMPLEMENTATION-PLAN.md` unless stated otherwise.

---

## Business Engine
**Purpose:** The overarching, admin-configurable layer that makes categories, pricing models, commissions, provider requirements, forms, and business content data-driven rather than hardcoded.
**Responsibilities:** Owns no data itself — it's the generalization layer that Category/Service/Financial/Form engines below eventually draw common configuration patterns from.
**Dependencies:** Category Engine, Rule Engine, Form Engine (all must produce enough concrete, repeated configuration needs to generalize from — see `../plans/ROADMAP.md`'s explicit "don't build this before a 2nd/3rd real use case exists" reasoning).
**Inputs:** Configuration changes from the other engines it generalizes.
**Outputs:** A shared configuration/rule-evaluation surface other engines call into.
**Future extensions:** The natural home for cross-cutting business logic once 3+ concrete engines exist with overlapping configuration needs.
**Status:** Not started. Catalog #1.

## Category Engine
**Purpose:** Manage the category/subcategory taxonomy and its visibility states.
**Responsibilities:** CRUD on `Category`/`SubCategory` (target entities, `15-DATA-DICTIONARY.md`); enforce the `PUBLIC`/`HIDDEN`/`LINK_ONLY`/`INVITE_ONLY`/`SCHEDULED`/`ARCHIVED` state machine (BR-004); expose category-scoped provider/service requirements (BR-013).
**Dependencies:** None — the recommended first engine to build (`../plans/ROADMAP.md` Phase 1).
**Inputs:** Admin-authored category definitions, visibility-state changes.
**Outputs:** A queryable category tree consumed by Marketplace browsing, Service assignment, and (later) category-specific Provider onboarding requirements.
**Future extensions:** Category-specific commission overrides (Financial Engine), category-specific dynamic forms (Form Engine/Business Engine).
**Status:** Not started. Catalog #2 ("Dynamic Category Management"). See `18-DOMAIN-MODEL.md`'s Marketplace context, `20-PERMISSION-MATRIX.md`'s Categories & Subcategories module.

## Provider Engine
**Purpose:** Provider registration, approval, document management, and public profile.
**Responsibilities:** Onboarding form (individual/commercial branching), document collection (commercial registration, municipal licence, tenancy agreement, bank info, logo, images, website, Maps location, hours), approval/reject/suspend/deactivate workflow, the public `ProviderProfile`.
**Dependencies:** Category Engine (for category-specific requirements, BR-013); Object Storage vendor selection (for Document/Attachment file storage — currently an open `TECH_STACK.md` decision, not this engine's to make).
**Inputs:** Provider-submitted application data and documents; Admin approval decisions.
**Outputs:** An `APPROVED` provider eligible to publish services; a public provider profile page.
**Future extensions:** Reject/suspend/deactivate actions (today: approve-only — BR-001's related gap); document-expiry tracking (`DocumentExpired` event, `19-EVENT-CATALOG.md`).
**Status:** Partial — real 4-field onboarding + approve-only workflow exists (`05-PROVIDER-EXPERIENCE.md`). Catalog #11 ("Provider Onboarding and Approval").

## Service Engine
**Purpose:** Service/experience creation, pricing, gallery, and public service pages.
**Responsibilities:** Already-real create/edit/publish/unpublish/archive/duplicate actions (Phase 4.2); target: category assignment, gallery/image support, admin/RFQ pricing control modes (BR-014).
**Dependencies:** Category Engine (category assignment); Financial Engine (pricing-control-mode enforcement beyond provider-set).
**Inputs:** Provider-authored service content and pricing.
**Outputs:** A published, bookable, category-assigned service with a public page.
**Future extensions:** Gallery/image model (needs Attachment/Object Storage, same as Provider Engine).
**Status:** Substantially real for the core CRUD/lifecycle; category assignment and gallery are target. Not explicitly named in the original 15-engine catalog as its own item — implicitly part of catalog #1/#2's scope, called out separately here per this document's requested structure.

## Booking Engine
**Purpose:** Reservation lifecycle from creation through completion or cancellation.
**Responsibilities:** Already the most mature system in the platform — full state machine (`docs/08-bookings/BOOKING_LIFECYCLE.md`), atomic capacity guarantees (BR-010), automatic expiry (BR-009), centralized transition validation (BR-007).
**Dependencies:** Service Engine (bookable target), Financial Engine (price/commission snapshot at confirmation).
**Inputs:** Customer booking requests; Provider accept/reject/start/complete actions.
**Outputs:** `Booking` records, `BookingStatusEvent` history, triggered notifications.
**Future extensions:** None currently planned beyond what exists — this engine is largely feature-complete for its current scope.
**Status:** Real and mature. Not explicitly named as a separate catalog engine (folded into the platform's existing, pre-dating-this-product-direction booking system) — included here because the user's engine list names it explicitly.

## Financial Engine
**Purpose:** Commission models, pricing control modes, and the full financial breakdown (gross/discount/tax/commission/net/paid/outstanding/settlement/transfer).
**Responsibilities:** Configurable commission (percentage/fixed/hybrid/zero/manual, BR-005); pricing control mode selection (BR-014); the Settlement lifecycle (currently entirely unmodeled — `15-DATA-DICTIONARY.md`).
**Dependencies:** Category Engine (per-category commission rules); Provider Engine (settled bank/payout-destination data).
**Inputs:** Booking confirmations (price/commission snapshot trigger), admin commission/pricing policy.
**Outputs:** `Payment`, `WalletTransaction`, (target) `Settlement` records; provider payout eligibility.
**Future extensions:** Real payout-processing integration (currently unscoped whether this is even planned as an automated integration vs. an admin-tracked manual status).
**Status:** Partial (fixed 3-tier commission only) — see `08-PRICING-COMMISSIONS.md`. Catalog #7 ("Financial and Commission Engine").

## Communication Engine
**Purpose:** Internal messaging and support ticketing, both mediated by BARQ.
**Responsibilities:** `Conversation`/`Message` (target), `SupportTicket` (schema-only) workflows; enforcing BR-002/BR-003's no-direct-contact rule structurally, not by convention.
**Dependencies:** None blocking — can be built once scoped, though benefits from Notification Engine's infrastructure.
**Inputs:** Customer/provider messages, support requests.
**Outputs:** Mediated conversation threads; resolved/escalated support tickets.
**Future extensions:** "ساعدني" branding/entry point as the customer-facing name for the Support half.
**Status:** Not started (SupportTicket schema-only; Conversation/Message don't exist). Catalog #12 + #13 combined here as "Communication Engine," matching `../plans/ROADMAP.md` Phase 6's grouping.

## Translation Engine
**Purpose:** AI-assisted translation workflow with review states for provider-generated business content.
**Responsibilities:** Propose translations for bilingual (or, per an open question, multilingual) provider content; hold them in a review state until approved.
**Dependencies:** An LLM Gateway abstraction (approved-at-requirement-level per `TECH_STACK.md` §11, not yet implemented; `LLM_GATEWAY_API_KEY` is a reserved, unused env var).
**Inputs:** Provider-authored content in one language.
**Outputs:** Proposed translations in other supported languages, gated by a review/approval step before going live.
**Future extensions:** Possible extension to all 8 UI locales for provider content, not just `{ar, en}` — open question, `13-OPEN-QUESTIONS.md`.
**Status:** Not started. Catalog #8 ("Translation Management"). Static UI translations (BR-016) are explicitly out of this engine's scope — see `09-TRANSLATION-I18N.md`.

## CMS Engine
**Purpose:** Admin-manageable content beyond the homepage specifically (legal pages, help content, etc., if ever made dynamic).
**Responsibilities:** Generic content storage/versioning — the broader capability Homepage Engine (below) would be one consumer of.
**Dependencies:** None technical; depends on product scoping of which static pages (if any) actually need to become dynamic.
**Inputs:** Admin-authored content.
**Outputs:** Renderable content blocks for whichever pages adopt it.
**Future extensions:** Could subsume Homepage Engine entirely, or the two could stay separate (homepage-specific vs. general-purpose) — undecided.
**Status:** Not started. Part of catalog #9 ("CMS and Dynamic Homepage") — split from Homepage Engine per this document's requested structure; see the reconciliation note at the top of this file.

## Homepage Engine
**Purpose:** Manage the homepage's specific sections and their order/content.
**Responsibilities:** The `HomepageSection` entity (target, `15-DATA-DICTIONARY.md`); today, 3 of 12 sections already read real data directly in component code (Featured Experiences, Providers, Stats) without any generic "section" abstraction.
**Dependencies:** Category Engine (a "browse by category" homepage section would reference it).
**Inputs:** Admin section configuration.
**Outputs:** The rendered homepage.
**Future extensions:** Could be generalized into/absorbed by the CMS Engine above.
**Status:** Not started as a manageable entity. Part of catalog #9.

## Notification Engine
**Purpose:** Multi-channel, admin-configurable notification triggers.
**Responsibilities:** Today: one-way booking/contract-lifecycle notifications only (`WHATSAPP`/`EMAIL`/`SMS`), no admin-configurable rules. Target: any engine can register a trigger condition → notification template mapping, admin-editable.
**Dependencies:** None blocking further extension of what already exists.
**Inputs:** Domain events (see `19-EVENT-CATALOG.md`) from any other engine.
**Outputs:** `Notification` rows, delivered via the existing channel abstraction.
**Future extensions:** In-app/push channel value (doesn't exist in `NotificationChannel` today).
**Status:** Partial — real for booking/contract lifecycle specifically. Catalog #6.

## Workflow Engine
**Purpose:** A generic, admin-configurable state-machine engine.
**Responsibilities:** Would generalize the pattern already proven twice in this codebase (`src/lib/booking/lifecycle/`, `src/lib/contracts/lifecycle/`) into something non-engineers could configure for a new domain concept without a code change.
**Dependencies:** Enough real, concrete state-machine needs (beyond Booking and Contract, which are fine staying hardcoded) to justify generalizing — per YAGNI, not built speculatively.
**Inputs:** A workflow definition (states, allowed transitions, hooks).
**Outputs:** A running instance's current state + its transition history (mirroring `BookingStatusEvent`'s existing shape).
**Future extensions:** Could become the substrate `SupportTicket`'s status lifecycle and a future `Settlement` lifecycle both run on, instead of each getting its own hand-coded state machine.
**Status:** Not started as a generic engine; 2 hardcoded domain-specific instances already exist and remain the reference implementation. Catalog #4.

## Rule Engine
**Purpose:** Generic business-rule evaluation (e.g., "if category X and booking value > Y, apply Z% commission").
**Responsibilities:** Would formalize what's currently scattered, hardcoded logic (e.g. `service-status-policy.ts`'s transition matrix, `cancellation-policy.ts`) into a single, admin-configurable evaluation surface.
**Dependencies:** Same YAGNI caveat as Workflow Engine — needs multiple real, concrete rule sets to generalize from first.
**Inputs:** Rule definitions (conditions → actions); the same `16-BUSINESS-RULES.md` registry could plausibly become this engine's actual configuration source once rules there are enforceable rather than descriptive.
**Outputs:** Rule evaluation results consumed by whichever engine calls it.
**Future extensions:** Could eventually make `16-BUSINESS-RULES.md`'s registry a live, enforced configuration rather than a documentation artifact.
**Status:** Not started. Catalog #5.

## AI Center
**Purpose:** AI-assisted capabilities across the platform, under ADR-0008's permanent human-in-the-loop governance.
**Responsibilities:** Whatever each deployed `AIAgent` (target entity, schema exists) is scoped to do — translation assistance, admin recommendations, provider performance insights, etc. — always with mandatory human approval for anything touching money, trust, contracts, or PII (BR-020).
**Dependencies:** The engines an AI agent would actually call (Category, Business, Notification, etc.) existing as real, versioned, stable APIs first (ADR-0011, BR-018) — see `../plans/ROADMAP.md`'s explicit "build this last" reasoning.
**Inputs:** Whatever each agent's own governing specification defines (per `docs/03-platform-capabilities/AI_AGENTS.md`).
**Outputs:** Recommendations/proposals requiring human action — never an autonomous write to money/trust/contract/PII data.
**Future extensions:** Genuinely open — contingent on which agents are actually approved to build.
**Status:** Schema-only (`AIAgent` model), zero application code. Catalog #14.

## Analytics Engine
**Purpose:** Business intelligence and reporting.
**Responsibilities:** Entirely unscoped — see `18-DOMAIN-MODEL.md`'s Analytics section and `13-OPEN-QUESTIONS.md`.
**Dependencies:** Real data volume from the other engines (there's limited value building analytics before Categories/Financial/Bookings generate enough real activity to analyze).
**Inputs:** Unscoped.
**Outputs:** Unscoped.
**Future extensions:** Cannot be meaningfully specified further until product scoping happens.
**Status:** Not started, not scoped. Newly introduced by `../plans/ROADMAP.md` Phase 9 — not part of the original 15-engine catalog.

## Feature Flag Engine
**Purpose:** Toggle platform capabilities per environment/rollout without a code deploy.
**Responsibilities:** `FeatureFlag` CRUD (target entity); flag evaluation at whatever call sites opt in.
**Dependencies:** None technical.
**Inputs:** Admin flag definitions and toggle state.
**Outputs:** A boolean (or richer) evaluation result any code path can check.
**Future extensions:** Per-role or per-segment flag targeting (today's spec implies simple on/off; segment-targeting is a plausible later refinement, not committed).
**Status:** Not started. Catalog #10.

## Permission Engine
**Purpose:** Granular, beyond-the-4-fixed-roles permission enforcement.
**Responsibilities:** Would generalize `20-PERMISSION-MATRIX.md`'s currently-static grid into a live, queryable authorization surface — the concrete mechanism behind `IDENTITY_AND_ACCESS.md`'s existing philosophy.
**Dependencies:** Real operational need for finer granularity than the current 4 roles + 3 `StaffRole` values provide (per `IDENTITY_AND_ACCESS.md` §2's "Role Simplicity" principle — not built ahead of that need).
**Inputs:** Role/permission assignments.
**Outputs:** Authorization decisions consumed by every other engine's own access checks.
**Future extensions:** ABAC/Policy-Based Access, per `IDENTITY_AND_ACCESS.md` §13 (already documented there as directional-only, not committed).
**Status:** Today's RBAC (`src/lib/auth/rbac.ts`) is real and code-controlled but role-based only, not a distinct "engine." Half of catalog #15 ("Audit Trail **and Permission Engine**").

## Audit Engine
**Purpose:** Immutable record of who did what, when, to what, with what before/after values.
**Responsibilities:** Already real for 4 mutation types (provider approval, service publish/unpublish/archive, availability CRUD) via `AuditLog` (Phase 5.2), written atomically with the mutation (BR-019). `BookingStatusEvent`/`BookingContractEvent` cover booking/contract transitions separately and predate this general mechanism.
**Dependencies:** None — this is the one item on this list that's genuinely operational today, just narrow in coverage.
**Inputs:** Every admin/provider mutation not already covered by a dedicated event-history model.
**Outputs:** Queryable audit trail (no viewer UI exists yet — write-only today).
**Future extensions:** A viewer UI; extending write-coverage to every new mutation each future engine introduces, incrementally, per `../plans/ROADMAP.md`'s cross-cutting note.
**Status:** Partial (write-only, 4 mutation types). Half of catalog #15.
