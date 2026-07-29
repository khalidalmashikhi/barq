# ADR-0014: Service-to-Category Relational Taxonomy

- **Purpose:** Propose how `Service` should relate to the real `Category`/`SubCategory` models (`ADR-0013`, Phase 1.1) so that homepage/dashboard category navigation and the `/services` marketplace filter can query a real relationship instead of the temporary keyword-match bridge shipped in the UX/Navigation Remediation (2026-07-26).
- **Scope:** The cardinality and shape of `Service`'s relationship to `Category`/`SubCategory` only — one field vs. two, nullable vs. required, single-category vs. many-to-many. Whether a join table is warranted.
- **Out of Scope:** The actual schema edit, migration, admin UI, or query-layer code (none of that is performed by this ADR — decision only, per instruction). Category/SubCategory's own visibility model (`BR-004`, already decided in `ADR-0013`) is not reopened. Discovery/Search/Featured/Campaigns/Recommendations (`ADR-0013`'s named future Marketplace responsibilities beyond plain filtering) are not addressed here.
- **Dependencies:** `ADR-0013-marketplace-bounded-context.md` (the Category/SubCategory models and Marketplace Bounded Context this ADR extends), `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md` (frozen phase order — this ADR's implementation is detail folded into the existing Phase 3, not a new phase), `docs/project-memory/07-CATEGORIES.md` (this ADR resolves that document's previously-open "how does Category relate to Service" question), `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md` (the implementation plan this ADR's recommendation feeds).
- **Status:** Draft v0.1 — Proposed, not approved. Recorded per the Platform Owner's explicit instruction not to auto-approve.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

The UX/Navigation Remediation phase (2026-07-26) made BARQ's homepage and dashboard category cards actually navigate somewhere (`/services?category=<slug>`) and made the services page apply a real filter for the first time. But no relational link between `Service` and `Category` exists in the schema — `Category`/`SubCategory` (Phase 1.1, `ADR-0013`) were built admin-first, with `Service.categoryId` assignment explicitly named and deferred ("a Provider-facing change, out of Phase 1.1's scope" — `07-CATEGORIES.md`). So that remediation shipped a documented, honest **keyword-match bridge**: `getServices()` matches a category's already-translated display label as a bilingual substring against `Service.name`, wrapped in its own `AND` clause alongside `search`. This works today only because Oman tour names happen to sometimes contain their category word in English or Arabic — most categories (e.g. "Transport") correctly return zero results, since no service is actually about transport.

This is acceptable as a temporary UX bridge (per the Platform Owner's explicit framing) but is not sound long-term: it cannot support subcategory filtering, cannot be indexed efficiently, silently breaks if a service is renamed, and gives category browsing no real database-backed meaning. This ADR proposes the relational fix.

Three shapes were considered for how `Service` should relate to `Category`:

## Options Considered

**Option 1 — One `Category` per `Service`, optional `SubCategory` (single foreign key each).**
`Service.categoryId` (nullable at first, see migration plan) + `Service.subCategoryId` (nullable, must belong to `categoryId`'s own children when set). A service is "Desert Safari," full stop — not simultaneously "Desert Safari" and "Cultural Tours."

**Option 2 — Many-to-many via a join table (`ServiceCategory`).**
A service could carry multiple categories (e.g. a combined "desert camping + stargazing" tour tagged under both Desert and Photography). Requires a new join model, join queries for every filter, and a decision on whether `SubCategory` also needs its own join table.

**Option 3 — Keyword-only, permanently.**
Keep today's bridge as the long-term mechanism rather than a temporary one; never add a relational field.

## Decision (Recommended, pending approval)

**Option 1 is recommended:** a single, nullable `Service.categoryId` plus an optional, nullable `Service.subCategoryId`.

**Why not Option 2 (many-to-many):** Nothing in BARQ's actual domain today names a real case for a service belonging to more than one top-level category — Oman tourism experiences (the seed data, the product framing in `03-PRODUCT-REQUIREMENTS.md`, `07-CATEGORIES.md`'s own example list of accommodation/transport/restaurants/activities) are naturally single-category in the way a hotel room or a desert-safari tour is not simultaneously two different kinds of business. Building a join table, its own admin UI for adding/removing multiple tags, and query-layer logic to filter and de-duplicate across many-to-many joins is real, ongoing complexity with no concrete requirement driving it — exactly the kind of speculative generality `docs/00-foundation/PROJECT_RULES.md`'s YAGNI principle and `ARCHITECTURE_PRINCIPLES.md` Principle 17 (Simplicity over Cleverness) argue against. If a genuine multi-category need surfaces later (e.g. a "Desert Safari" tour that provider-onboarding wants to also cross-list under "Adventure Sports"), a join table can be introduced additively then, without disturbing this ADR's single-FK shape for the common case — it is not a one-way door.

**Why not Option 3 (keyword-only, permanently):** The keyword bridge cannot support subcategory filtering (there is no subcategory-scoped translated label to match against reliably), cannot be indexed (a JSON path substring match on `Service.name` cannot use a normal B-tree index the way a foreign-key column can), and gives category browsing no real meaning — a service's category membership should be an admin/provider fact recorded once, not re-derived by accident from whatever words happen to appear in a translated display name. It was correctly scoped as temporary in the remediation that introduced it, and this ADR's job is to close that temporariness, not ratify it.

**Concretely, this ADR proposes:**
1. `Service` gains `categoryId String? @db.Uuid` with `category Category? @relation(fields: [categoryId], references: [id])`.
2. `Service` gains `subCategoryId String? @db.Uuid` with `subCategory SubCategory? @relation(fields: [subCategoryId], references: [id])`.
3. Both fields are **nullable indefinitely** at the schema level — see `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md`'s Migration Strategy for why "required" is an application-layer rule (enforced at creation/publish time going forward), never a `NOT NULL` database constraint, given the existing-data backfill problem.
4. A same-transaction application-layer invariant: if `subCategoryId` is set, its parent `categoryId` must equal `Service.categoryId` (enforced in the update/assignment action, not the database — Postgres has no native cross-column-vs-related-row check without a trigger, and a trigger is more machinery than this needs).
5. Both foreign keys use `onDelete: Restrict` (Prisma default when unspecified) — deleting a `Category`/`SubCategory` that still has assigned Services must fail loudly, not silently null out or cascade-delete real Services. Category/SubCategory deletion is rare (mostly `ARCHIVED`, per `BR-004`'s visibility states) and Services should never disappear as a side effect of a taxonomy edit.

## Consequences

**Positive:** Category browsing becomes a real, indexed, database-backed relationship instead of a string-matching accident. Subcategory filtering becomes possible for the first time. `Category`/`SubCategory` visibility rules (`BR-004`) can be joined against directly when filtering (e.g. excluding services whose category is `ARCHIVED`). The keyword bridge can be retired once assignment is complete, per the compatibility plan.

**Negative / Cost:** Every existing `Service` (seed and, eventually, real production data) starts with `categoryId = NULL` — a real backfill/assignment problem, not a free migration. Until assignment is complete, "browse by category" continues to under-represent the catalog (some services simply have no category yet), which must be handled gracefully in the marketplace UI (see the implementation plan's Marketplace Experience section), not hidden.

**Follow-up Required:** The actual schema migration, admin assignment UI, query-layer update, and keyword-bridge retirement are implementation work — not performed by this ADR. See `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md` for the phased implementation proposal, itself pending separate approval per `EXECUTION_CONTRACT.md` (EC-001) before any phase begins.

## Alternatives Considered

- **Option 2 — Many-to-many via join table:** Rejected for now (not permanently) — see "Why not Option 2" above. Revisit only if a concrete multi-category product requirement is stated, at which point a join table can be added without reworking Option 1's single-FK columns.
- **Option 3 — Keyword-only, permanently:** Rejected — see "Why not Option 3" above. The keyword bridge remains in place as a compatibility fallback during migration (per the implementation plan), never as the intended end state.

## Migration Implications

Full detail lives in `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md`'s "Migration Strategy" section (not repeated here per SSOT). Summary: additive, nullable columns — low schema-migration risk on their own. The real risk is entirely in the backfill/assignment gap (existing Services with no category), which is a data and product-workflow problem, not a schema one, and is why both new columns stay nullable indefinitely rather than becoming `NOT NULL` after a fixed grace period.

## Open Questions

1. **Who assigns categories to existing (pre-migration) services** — a one-time admin bulk-assignment pass, a required step the next time each provider edits their service, or both? Not decided here; see the implementation plan's Migration Strategy section for the proposed approach, itself pending approval.
2. **Does `Service.serviceType`'s existing CTI discriminator ever get replaced by Category**, or do the two stay permanently independent (a Service is `EXPERIENCE`-typed *and* separately category-tagged)? This ADR assumes the latter (independent) since `serviceType` mirrors `AssetType`'s CTI specialization pattern (`Experience` today, potentially other specializations later) and is a structural/technical concept, while `Category` is a business/browsing concept — conflating them would reintroduce the exact confusion `07-CATEGORIES.md` and `get-services.ts`'s own comments have repeatedly warned against. Not fully closed until implementation.
3. **Should category assignment become a required field before a Service can be `PUBLISHED`** (an application-layer rule, mirroring how publishing already requires at least one `ACTIVE` `Price`)? Proposed as a *future* tightening once backfill is complete, not from day one — see the implementation plan's Migration Strategy for the phased nullable-to-effectively-required approach.

---

## Related Documents

- `ADR-0013-marketplace-bounded-context.md` — the Category/SubCategory models and Marketplace Bounded Context this ADR extends; explicitly named `Service.categoryId` as a deferred future decision for "whichever phase actually builds it" to record, citing both it and `ADR-0012`.
- `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md` — the frozen phase order this ADR's implementation must fit inside (Phase 3, Service Engine) without introducing a new phase number.
- `docs/project-memory/07-CATEGORIES.md` — the "remaining design question" this ADR proposes an answer to.
- `docs/project-memory/15-DATA-DICTIONARY.md` — `Category`, `SubCategory`, `Service` entity entries, each already flagging category assignment as a named planned extension.
- `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md` — the implementation plan built against this ADR's recommendation.
- `docs/plans/ROADMAP.md` — Phase 3 (Service Engine), where this work is folded in as detail, not a new phase.

## Future ADR References

- If a genuine multi-category requirement is later stated (see "Why not Option 2"), the join-table alternative should be re-evaluated in a superseding ADR, not silently added on top of this one.
- Any decision to make `Service.categoryId` a required (`NOT NULL`) database constraint, rather than an application-layer publish-time rule, should be recorded as a follow-up to this ADR once backfill is verifiably complete — not assumed here.
