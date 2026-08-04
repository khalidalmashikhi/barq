# ADR-0015 — ServiceType Spine & Taxonomy v2 (self-referential Category tree)

- **Purpose:** Record the frozen architecture for BARQ's category/taxonomy core after a three-generation architecture review, and define the exact P1 scope that implementation must follow without redesign. Establishes the **ServiceType behavioral spine** and collapses `Category`/`SubCategory` into a single **self-referential `Category` tree**, with `Category` as a browse/SEO taxonomy only.
- **Scope:** The taxonomy data model and the ServiceType classification concept: the self-referential `Category` tree, `Category.serviceTypeKey`, `Service.categoryId`, the `ProviderCategory` many-to-many relation, and the governance rule that behavior lives on ServiceType (not Category). Also the frozen implementation decisions for P1 (key representation, path, depth, seed, migration, rollback).
- **Out of Scope (deferred, not built in P1):** the unified Schema/Definition engine, dynamic attributes, provider dynamic forms, verification workflow, service options/variants, media model, search engine, pricing engine, tags, regions, analytics, AI embeddings, publish-time category enforcement, and any BookingStrategy/PricingStrategy interface (Rule of Two — introduced only when a second vertical creates real behavioral divergence). None of these are designed or built here; each is a later, separately-approved phase.
- **Dependencies:** `ADR-0013-marketplace-bounded-context.md` (Marketplace BC #16 that owns Category/SubCategory — this ADR evolves its entity shape), `ADR-0014-service-category-relational-taxonomy.md` (revised by this ADR — see below), `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md` (phase-order freeze this fits inside), `ADR-0002-modular-monolith.md` (the module pattern this ADR applies), `ADR-0005-bilingual-architecture.md` (JSON locale maps), `ADR-0006-database-baseline.md` (UUID v7, Decimal money), `ADR-0008-ai-agent-boundaries.md`, `ADR-0011-api-first-mobile-ready-architecture.md`.
- **Status:** Approved, Frozen. No redesign from this point; a required change during implementation must STOP and re-open this ADR with an explicit amendment, per the Platform Owner's freeze instruction.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

Three successive architecture reviews (recorded in the session's design dialogue) converged on one correction: BARQ is a **multi-vertical marketplace** (accommodation, transport, experiences, rentals, dining, events), and *behavior* — booking mechanics, pricing units, verification, commission, cancellation/refund — differs per **vertical**, not per browse category. The earlier taxonomy work had no home for that behavior and kept trying to hang it off `Category`. This ADR fixes the axis: **`Category` is discovery only; behavior belongs to a `ServiceType` spine.**

A parallel decision (final review) settled that BARQ adopts the **plugin *pattern*, not a plugin *platform*** (`ADR-0002` modular monolith): ServiceType behavior is implemented as first-party in-process modules behind stable interfaces + a registry, never dynamically loaded / third-party / runtime-installable. Per the **Rule of Two**, behavior interfaces (`BookingStrategy`, `PricingStrategy`) are NOT introduced until a second vertical creates real divergence — P1 introduces ServiceType only as a *classification*.

## Decision

**1. ServiceType is a code-owned classification, not an admin-CRUD table and not a plugin platform.**
- The authoritative *set* of ServiceTypes is defined in code (a `const` registry), because a vertical is inseparable from its (future) strategy code — a vertical that exists as data without code is a bug. A `ServiceType` **table as source of truth is rejected** (it would allow rows with no behavior → runtime failure, and lose compile-time exhaustiveness).
- The stored key is a **plain string column validated against the code registry, backed by a `CHECK` constraint** — NOT a Prisma enum. This matches the codebase's own, repeatedly-documented convention (`FeatureFlag.key`, `BookingContract.templateKey`, `AuditLog.action` are "plain String, not a Prisma enum, so adding one never needs a migration"), and avoids the enum's per-vertical `ALTER TYPE` migration and its rename/deprecate rigidity over a 10-year horizon. Compile-time exhaustiveness for future strategy dispatch is provided by an `as const` union, not the enum.
- A future **presentation projection table** (`service_types`, seeded/synced from the code registry, carrying only localized display data) may be added when a customer-facing/admin-editable consumer exists (P3+). It is a projection of the code-owned set, never an independent CRUD source.
- Governed keys (P1 registry): `EXPERIENCE`, `TRANSPORT`, `ACCOMMODATION`, `DINING`, `EVENT`, `RENTAL`. Only `EXPERIENCE` has real behavior today; the rest are classification labels until their phase builds them.

**2. `Category` becomes a single self-referential tree; `SubCategory` is collapsed into it.**
- `Category` gains `parentId` (self-relation) and a required `serviceTypeKey`. `SubCategory` rows become depth-1 `Category` children; the `sub_categories` table is retired (see Migration).
- **Max depth = 2 (hard cap 3), governed by a single code constant** (`MAX_CATEGORY_DEPTH`), not a schema constraint and not runtime-admin-configurable. The self-referential schema already supports arbitrary depth; only the app invariant caps it, so raising it later is a code change (plus a `path` column then), not a schema migration. Finer distinctions than depth-2 are Tags' job (deferred).
- **No materialized `path` column in P1.** At depth 2, ancestry is just `parentId`. When depth policy grows past 2 (and subtree filtering is needed, P3+), a **UUID path** is added (never a slug path — slugs are mutable; only UUIDs are stable).
- The stricter-of-ancestors effective-visibility rule (a HIDDEN/ARCHIVED ancestor hides descendants) is preserved across the tree. `CategoryVisibilityStatus` (BR-004's 6 states) is unchanged.

**3. `Category` is browse/SEO taxonomy only.** It never owns booking behavior, pricing behavior, commission, cancellation, or refund rules. Those belong to ServiceType (and the future pricing/policy engines). Commission/pricing remain a separate, unapproved financial engine (`BR-005`/`BR-014`/`BR-015`); `Category` is at most a future pointer target, never the owner.

**4. `Service.categoryId` is a single nullable FK to the most-specific `Category` node**, `onDelete: Restrict`. Nullable indefinitely at the schema level; publish-time "exactly one category" enforcement is an application rule added in a later phase (P4), mirroring how publishing already requires an ACTIVE `Price`. Existing services stay `categoryId = NULL` and fully valid during migration.

**5. Provider↔Category is many-to-many (`ProviderCategory`, "areas of activity").** No free-text categories. `isPrimary` is **deferred** (no P1 consumer); when added (P4), "exactly one primary per provider" is enforced by a **Postgres partial unique index**, never app-only logic.

**6. Seed is bootstrap-only and insert-if-absent (never `UPDATE`).** Re-running the seed must never overwrite an admin-modified production taxonomy. There is no `taxonomyVersion` column; ongoing curated baseline changes are versioned **data migrations** (ledger-tracked), and the admin UI is the primary production channel.

**7. Migration follows expand/contract.** The P1 migration expands (adds columns/tables, moves `sub_categories` rows into `categories`) and keeps `sub_categories` as an **unread shadow**; a later, verified follow-up migration drops it. The whole expand migration is transactional (enabled by using a string key, not an enum), and guards the data move with slug-collision, id-collision, and row-count-reconciliation assertions; defaulted `serviceTypeKey` backfills (to `EXPERIENCE`) are logged for admin correction.

## Consequences

**Positive:** one taxonomy model (no two-table duplication); a clear axis split (browse vs behavior) that resolves "should Category define booking/pricing/forms?" as "no — ServiceType does"; convention-consistent, migration-light vertical governance; a safe, reversible migration with a shadow window; existing services untouched.

**Negative / Cost:** collapsing `SubCategory` is a one-time destructive migration (mitigated by expand/contract + shadow). ServiceType classification exists before ServiceType *behavior* — an intentional Rule-of-Two gap; `Service.serviceType` (the CTI discriminator) and `Category.serviceTypeKey` are not yet reconciled (deferred to P4, recorded as BR-028).

## Alternatives Considered (rejected)

- **ServiceType as a source-of-truth table** — rejected: decouples the vertical set from the code that must implement it (drift; runtime failure on behavior-less rows; lost compile-time exhaustiveness).
- **ServiceType as a Prisma enum** — rejected for BARQ (defensible but inferior): per-vertical `ALTER TYPE` migrations, painful rename/deprecate, and inconsistency with the repo's string-key convention. A `CHECK` constraint recovers the enum's only real advantage (DB integrity).
- **Plugin platform** (dynamic loading, third-party SDK, injected routes/admin/API) — rejected: extensibility is not BARQ's business model; it contradicts `ADR-0002` and YAGNI (see the final review).
- **Materialized `path` in P1** — rejected as premature at depth 2 (no consumer until P3).
- **Unlimited nesting** — rejected: UX/query/caching cost with no Oman-tourism driver; Tags cover finer facets.
- **Two nullable FKs (`categoryId` + `subCategoryId`) on Service** (ADR-0014's original shape) — rejected in favor of a single FK to the most-specific node on the tree.

## Relationship to ADR-0014

`ADR-0014` proposed a two-table model with `Service.categoryId` + `Service.subCategoryId`. This ADR supersedes that shape: with a single self-referential tree, `Service` carries **one** nullable `categoryId` pointing at the most-specific node; ancestor grouping is by tree traversal (and, later, a UUID `path`). `ADR-0014`'s nullable-indefinitely and required-at-publish reasoning is retained.

## Open Questions

- Reconciliation of `Service.serviceType` (CTI discriminator) with `Category.serviceTypeKey` — deferred to P4 (BR-028), not created as an inconsistency by P1.

## Related Documents

`ADR-0013`, `ADR-0014`, `ADR-0012`, `ADR-0002`, `ADR-0005`, `ADR-0006`, `ADR-0011`; `docs/project-memory/07-CATEGORIES.md`, `15-DATA-DICTIONARY.md`, `16-BUSINESS-RULES.md` (BR-023–BR-028), `18-DOMAIN-MODEL.md`; `docs/plans/IMPLEMENTATION-PLAN.md`.
