# Roadmap — Frozen 10-Phase Implementation Order

**Frozen by `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md`.** This is the final phase order. No additional phases may be introduced without explicit, separate approval. It supersedes the previous 9-phase order (see `../project-memory/17-CHANGELOG-DECISIONS.md` for that prior reasoning's history).

Two things changed from the prior version of this document, both per `ADR-0012`:
1. **Phase 0 (Foundation Hardening) is now an explicit, numbered phase** rather than implicit prior work — it covers the hardening/enforcement work (e.g. BR-001 provider-approval enforcement) that must land before Phase 1 begins.
2. **Scope is explicitly bounded to BARQ-as-tourism-marketplace.** The generic multi-tenant SaaS concepts explored during this project's architecture review (Business Profiles, Module Packs, Entitlement Engine, Capability Layer, Billing, Theme Engine) are **documented, not scheduled** — see "Deferred architecture" below. None of them appear as a phase here, and none should be added as one without a new approval.

See `../project-memory/21-ENGINE-SPECIFICATIONS.md` for each real engine's Purpose/Responsibilities/Dependencies/Inputs/Outputs, and `../project-memory/18-DOMAIN-MODEL.md` for Bounded-Context grouping. This is ordering, not a committed schedule — each phase still needs its own scoped, approved implementation plan before code is written (see `IMPLEMENTATION-PLAN.md`).

**Every phase built against this order follows `EXECUTION_CONTRACT.md` (EC-001)** — before/after reporting, quality gates, one-engine-at-a-time discipline, and the mandatory stop-and-wait after each phase. This roadmap says *what* ships and *in what order*; `EXECUTION_CONTRACT.md` says *how* each of those phases is proposed, built, and verified.

## Current state snapshot (see `../project-memory/01-CURRENT-STATE.md` and `../project-memory/15-DATA-DICTIONARY.md` for full detail)

| # | Engine (original 15-engine catalog, `../project-memory/03-PRODUCT-REQUIREMENTS.md`) | State |
|---|---|---|
| 1 | Business Engine | Not exist |
| 2 | Dynamic Category Management | Not exist |
| 3 | Form Builder | Not exist |
| 4 | Workflow Engine | Not exist as generic (2 hardcoded domain-specific state machines exist) |
| 5 | Rule Engine | Not exist |
| 6 | Notification Engine | Partial (one-way, 3 channels, no admin rules) |
| 7 | Financial and Commission Engine | Partial (fixed 3-tier commission only) |
| 8 | Translation Management | Partial (static, curated, no AI/review workflow) |
| 9 | CMS and Dynamic Homepage | Partial (3 of 12 sections DB-driven) |
| 10 | Feature Flags | Not exist |
| 11 | Provider Onboarding and Approval | Partial/minimal — BR-001 (provider-approval gating on service/availability management) now enforced in code, see `../project-memory/16-BUSINESS-RULES.md` |
| 12 | Support / "ساعدني" Ticket Center | Schema-only |
| 13 | Internal Messaging Center | Not exist |
| 14 | AI Center | Schema-only |
| 15 | Audit Trail and Permission Engine | Partial (write-only audit log, fixed-role RBAC) |

## Frozen implementation order (Phase 0 through Phase 9)

### Phase 0 — Foundation Hardening
Enforcement and correctness work that must land before new product surface is built on top of it. In progress: BR-001 (block non-`APPROVED` providers from creating/editing/publishing/managing services and availability — implemented via `requireApprovedProvider()`), an Identity Architecture decision (PlatformOwner→ADMIN vs. →SUPER_ADMIN→ADMIN), and a Marketplace Bounded-Context validation (see `ADR-0012` — accepted).

### Phase 1 — Core Business Platform

**Why first:** foundational — nearly everything else becomes "category-aware" once this exists. Operates within the Marketplace Bounded Context accepted in `ADR-0012` (formal amendment of the Locked `DOMAIN_MODEL.md` to add Marketplace as Bounded Context #16 happens inside Phase 1.1 itself, not as a standalone documentation phase — see below).

Broken into 5 small, independently reviewable/testable/deployable/reversible sub-phases per its own approved Phase Planning pass (2026-07-23). Strictly sequential — each stops for approval before the next begins, per `EXECUTION_CONTRACT.md` (EC-001).

**Phase 1.1 — Category Domain.** `Category`/`SubCategory` Prisma models (bilingual name, visibility status, hierarchy) + migration; a `category-visibility-policy.ts` transition matrix for the `PUBLIC`/`HIDDEN`/`LINK_ONLY`/`INVITE_ONLY`/`SCHEDULED`/`ARCHIVED` states (BR-004), mirroring `service-status-policy.ts`'s existing pattern rather than introducing a new one; admin-only CRUD + visibility-transition Server Actions; error codes; 8-locale translations; unit tests. Backend only, no admin UI yet. **Two prerequisites are folded into this phase rather than given their own roadmap slot:** (a) the `DOMAIN_MODEL.md` amendment adding Marketplace as Bounded Context #16 (a documentation update made as part of the change that needs it, not a separate ADR-only phase); (b) Admin account provisioning — since no code path today creates an `Admin` row and this phase is the first to make a second admin capability meaningfully necessary to reach, a guarded, one-time bootstrap mechanism is built as a prerequisite task inside this phase, not a dedicated phase of its own. Explicitly excludes `Service.categoryId` assignment (a Provider-facing change, out of Phase 1's scope) — Categories exist and are admin-manageable by the end of Phase 1, but no Service is assigned to one and no customer-facing browsing exists yet; that is Marketplace's job, later.

**Phase 1.2 — Category Admin UI.** `/admin/categories` list/create/edit/archive/visibility-toggle pages on top of Phase 1.1's actions, reusing the existing design-system primitives (Phase F.1) and admin layout.

**Phase 1.3 — Feature Flags.** A plain on/off `FeatureFlag` model (key, enabled, description) — deliberately not a targeting-rules engine, per EC-001 principle 1. Admin CRUD, admin UI, and an `isFeatureEnabled(key)` read helper for other code to consume. Fully independent of Category; sequenced here so it exists as a kill-switch before Phase 1.5 needs one.

**Phase 1.4 — Homepage Sections Backend.** A generic, admin-configurable `HomepageSection` model (order, visibility, content-type reference) + migration, admin CRUD, and admin UI to manage section order/visibility. Deliberately does not touch the live public homepage yet — nothing public reads from it until Phase 1.5.

**Phase 1.5 — Homepage Rendering.** Wires the real `src/app/[locale]/page.tsx` (which today mixes real DB-driven sections with static JSX in one file) to read section order/visibility from Phase 1.4's model instead of hardcoded component order. Gated behind Phase 1.3's Feature Flags for instant rollback without a redeploy. The only sub-phase touching live public-facing code — highest scrutiny, run last. Includes a concrete decision on `src/components/landing/categories-section.tsx` (today's hardcoded, non-functional 6-item array), made explicitly in that phase's own before-implementation proposal, not assumed here.

### Phase 2 — Provider Engine
- Registration (extends engine #11)
- Verification (extends engine #11's approval half)
- Documents (new `Document`/`Attachment` entities, `../project-memory/15-DATA-DICTIONARY.md`)
- Dynamic Forms (provider-facing application of engine #3, Form Builder)

**Depends on:** Phase 1 if category-specific provider requirements (BR-013) are in scope for the first cut.

### Phase 3 — Service Engine
Service Creation (already real — Phase 4.2), Pricing (engine #7's pricing-control half), Gallery, Public Service Pages. **Depends on:** Phase 1 (category assignment) and Phase 2 (provider onboarding shape).

#### Relational Service Taxonomy & Marketplace Discovery

**Not implemented in the current remediation. Detail folded into this Phase 3 — not a new phase number, does not alter the frozen order above.**

The UX/Navigation Remediation (2026-07-26) made homepage/dashboard category cards navigate to `/{locale}/services?category=<slug>` and made the services page apply a real filter for the first time — but only via a temporary, honestly-documented **keyword-match bridge** (`getServices()`'s `categoryKeyword` filter matches a category's translated display label as a bilingual substring against `Service.name`), because the current schema has no relationship between `Service` and `Category`/`SubCategory` (Phase 1.1, `ADR-0013`) at all. This is acceptable as a temporary UX bridge but is not BARQ's final architecture — it cannot support subcategory filtering, cannot be indexed, and silently depends on service names happening to contain their category's word.

The final model must support: `Category`, `SubCategory`, and `Service` linked by direct relational foreign keys; stable slugs; locale-aware (bilingual) names (already true for Category/SubCategory since Phase 1.1); admin (and provider) assignment of a category/subcategory to a service; database-backed category filtering; database-backed subcategory filtering; correct composition with search/price/provider/sort filters; and a backward-compatible migration path away from the temporary keyword filter that never breaks existing category navigation mid-rollout.

See `ADR-0014-service-category-relational-taxonomy.md` (Draft, proposes a single nullable `Service.categoryId` + optional nullable `subCategoryId`, not a many-to-many join table) and `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md` (the full implementation plan: data model, migration strategy, admin experience, marketplace experience, query layer, backward compatibility, and four proposed Stages) for full detail. **Both are drafted, not approved** — no implementation Stage may begin without its own separate approval, per `EXECUTION_CONTRACT.md` (EC-001).

### Phase 4 — Booking Engine
Already substantially real and mature (Phases E.1, 4.1, 4.2, 5.1) — extends, not builds from zero. Any extension goes through the existing centralized lifecycle engine (`src/lib/booking/lifecycle/`), never bypassing it (BR-007).

### Phase 5 — Financial Engine
Engine #7's financial half — discount/tax/net/settlement/transfer tracking, configurable commission models (BR-005, BR-014, BR-015). High-risk, high-scrutiny (real money). **Depends on:** Phase 1 (per-category commission rules) and Phase 2 (settled provider payout-destination model). Billing remains an architecture-only Bounded Context per `ADR-0012` — no Subscription/Invoice/Coupon-style entities are introduced here; this phase is BARQ's own transactional financial model, not a SaaS billing system.

### Phase 6 — Communication Engine
Internal Messaging (engine #13), Support Center / "ساعدني" (engine #12, schema-only today). **Must satisfy from day one:** BR-002/BR-003 (no direct provider-contact exposure) — see `../project-memory/10-COMMUNICATION-POLICY.md`.

### Phase 7 — Translation
Engine #8 — AI-assisted translation workflow with review states, for provider-generated content specifically (static UI strings stay developer-curated per BR-016). See `../project-memory/09-TRANSLATION-I18N.md`.

### Phase 8 — AI Assistance
Engine #14. Deliberately near the end: `ADR-0008`'s 17 permanent AI boundaries (BR-020) mean this is safest to build once Audit Trail coverage (engine #15) is broad and once the engines an AI agent would call already exist as real, versioned APIs (`ADR-0011`, BR-018).

### Phase 9 — Analytics
Not part of the original 15-engine catalog; needs its own product scoping (admin business intelligence? provider performance dashboards? both?) before an implementation plan can be written. Flagged in `../project-memory/13-OPEN-QUESTIONS.md`.

**No additional phases should be introduced without explicit approval — see `ADR-0012`.**

## Audit Trail and Permission Engine (#15) — cuts across every phase

Not sequenced into a single phase; extends incrementally alongside whichever phase is currently being built — every new admin-configurable capability gets its own `AuditLog` entries and RBAC checks as it ships, following the pattern established in Phase 5.2 (`../../src/lib/audit/record-audit-event.ts`). See BR-019.

## Deferred architecture (documented, not scheduled — per `ADR-0012`)

The following remain valid, documented architectural direction for a possible future, but appear in **no phase above** and must not be scheduled without a new, explicit approval superseding `ADR-0012`:
- Module Packs (with many-to-many dependency/feature-sharing model, if ever built)
- Entitlement Engine
- Business Profiles beyond onboarding presets
- Theme Engine (kept independent of any future entitlement system)
- Billing as implemented code (only its Bounded-Context seam is reserved)
- Capability Layer (`Plan → Pack → Capability → Feature`) — rejected for now, not merely deferred; see `ADR-0012` §3

## Not decided by this document

- Exact timing/dates — this is ordering, not a schedule.
- Whether phases can run in parallel across multiple engineers/agents, or must be strictly sequential.
- The real schema design for any phase — each phase's own implementation plan's job (see `IMPLEMENTATION-PLAN.md`).
- Analytics' actual scope (Phase 9) — genuinely undefined, see above.
