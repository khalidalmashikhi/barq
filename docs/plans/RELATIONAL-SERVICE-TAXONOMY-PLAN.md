# Plan — Relational Service Taxonomy & Marketplace Discovery

**Status: Drafted, not approved. No phase in this plan may begin without its own separate, explicit approval per `EXECUTION_CONTRACT.md` (EC-001) — filling in this document is scoping, not authorization.**

This plan implements the recommendation of `docs/08-governance/adr/ADR-0014-service-category-relational-taxonomy.md` (itself Draft, pending approval): replace the temporary keyword-based category filter shipped in the UX/Navigation Remediation (2026-07-26) with a real `Service` ↔ `Category`/`SubCategory` relationship.

**This is not a new numbered phase in `ROADMAP.md`.** It is detail folded into the already-frozen **Phase 3 — Service Engine**, which already states "Depends on: Phase 1 (category assignment)." `ADR-0012` freezes the 10-phase order; nothing here adds an 11th phase. To avoid confusing this plan's own internal stages with `ROADMAP.md`'s Phase 0–9 numbering, this document calls its internal steps **Stages (1–4)**, never "Phase."

---

## 1. Data Model

### Recommended shape (per `ADR-0014`)

```prisma
model Service {
  // ...existing fields unchanged...
  categoryId    String?      @db.Uuid
  category      Category?    @relation(fields: [categoryId], references: [id])
  subCategoryId String?      @db.Uuid
  subCategory   SubCategory? @relation(fields: [subCategoryId], references: [id])

  @@index([categoryId])
  @@index([subCategoryId])
}

model Category {
  // ...existing fields unchanged...
  services Service[]
}

model SubCategory {
  // ...existing fields unchanged...
  services Service[]
}
```

### Cardinality

One `Category` per `Service` (nullable), one optional `SubCategory` per `Service` (nullable). Rejected: many-to-many join table — see `ADR-0014` "Why not Option 2" for the full reasoning (no concrete multi-category requirement exists in BARQ's domain today; a join table is additive later if one ever emerges, so this is not a one-way door).

### Foreign keys and deletion behavior

- Both FKs default to Prisma's `Restrict` behavior (no `onDelete` override) — deleting a `Category`/`SubCategory` that still has assigned Services must fail at the database level, not silently null out real Services or cascade-delete them. Category/SubCategory removal is expected to be rare (`ARCHIVED` visibility, per `BR-004`, is the normal "retire a category" path — actual row deletion should be exceptional).
- `subCategoryId`, when set, must belong to `categoryId`'s own children. This is an **application-layer invariant**, enforced in the assignment action (see §3), not a database constraint — Postgres cannot natively express "this FK's parent must equal that other FK's value" without a trigger, and a trigger is disproportionate machinery for a check a Server Action can make in one query.

### Indexes

`@@index([categoryId])` and `@@index([subCategoryId])` on `Service` — both are filter columns the marketplace query will use directly (see §5, Query Layer). Mirrors the existing `@@index([providerId])`/`@@index([status])` pattern already on `Service`.

### Slug uniqueness

Unchanged — `Category.slug` and `SubCategory.slug` are already `@unique` (Phase 1.1). This plan does not touch slug generation; it reuses the existing slugs the homepage/dashboard cards already carry (`desert-safari`, `mountains`, etc. — see §4) as the join key between the UI's static card slugs and the real `Category`/`SubCategory` rows, once each card is mapped to a real row (see Stage 1's "slug reconciliation" task below — the UI's current hardcoded slugs and the admin-created `Category.slug` values are not guaranteed to already match, and reconciling them is real work, not an assumption).

### Localization strategy

No change — `Category.name`/`SubCategory.name` are already bilingual `Json` (`{ar, en}`), consistent with `Service.name`. The marketplace's selected-category label (today resolved from `messages/*/landing.json` / `dashboard.json` translation keys, per the temporary bridge) should, once relational, be resolved from the real `Category.name`/`SubCategory.name` JSON via `extractLocalizedText()` — the same helper already used for `Service.name` and `Provider.businessName` — rather than from static translation-key lookups. This removes the current hardcoded `LANDING_CATEGORY_SLUGS`/`DASHBOARD_CATEGORY_SLUGS` switch statements in `services/page.tsx` entirely (see §4).

### Migration safety

Both new columns are additive and nullable — a pure `ALTER TABLE ... ADD COLUMN` with no default-value backfill required at the schema level, no lock-heavy rewrite, safe to run against a populated table. The real risk is not the migration statement itself but the data gap it creates (every existing Service starts `categoryId = NULL`) — addressed in full in §2.

---

## 2. Migration Strategy

### How existing services receive categories

Proposed two-track approach, not mutually exclusive:
1. **One-time admin bulk-assignment pass** — extend the existing admin Services list/detail UI (`src/app/[locale]/admin/services/`) with a category/subcategory picker, and let the admin work through existing services in normal course, without a forced blocking migration script. Given BARQ's current seed-scale catalog (tens of services, not thousands), this is realistic without tooling beyond the admin UI itself.
2. **Prompt at next edit** — when a provider or admin edits a service that has no `categoryId`, the edit form surfaces the category picker as an encouraged (not blocking) field, so assignment also happens organically over time.

No automatic inference (e.g. re-running the keyword-match logic to *auto-assign* categories) is proposed — that would silently encode the same unreliable heuristic this whole plan exists to retire, just at write-time instead of read-time. Assignment is a human (admin/provider) decision, not a guess.

### How uncategorized services are handled

Uncategorized services (`categoryId = NULL`) simply do not appear when a category filter is applied — this is correct, not a bug: a service genuinely has no category yet. They continue to appear normally everywhere category is *not* the active filter (homepage "Featured," "Most Booked," general `/services` browsing with no `category` param, search). No uncategorized service is ever hidden from the marketplace at large — only from category-scoped views, which is the accurate behavior.

### Nullable fields, and when constraints tighten

- **Stage 1 (schema foundation):** both fields nullable, no application-layer requirement yet.
- **Stage 2 (assignment tooling ships):** still nullable — assignment becomes *possible*, not mandatory.
- **Stage 3 (relational filtering ships):** still nullable at the database level. An application-layer soft rule may be introduced here: publishing a **new** service (not editing an existing one) prompts for a category, mirroring the existing "publishing requires at least one `ACTIVE` `Price`" pattern (`get-service-detail.ts`) — but this is a UX nudge, not a hard block, until backfill coverage is measured (see below).
- **`NOT NULL` at the database level is explicitly not scheduled by this plan.** It is named in `ADR-0014`'s Open Questions as a possible future tightening once backfill is verifiably complete (e.g. a measured 95%+ of `PUBLISHED` services have a `categoryId`), to be decided and recorded as its own follow-up decision when that measurement is actually taken — not assumed here, and not a Stage 4 deliverable.

### Rollback

Every schema change here is additive (new nullable columns, new indexes) — a rollback is a plain `ALTER TABLE ... DROP COLUMN` with no data-loss consequence for any *other* field, reversible in a single migration step. The only real rollback cost is losing whatever category assignments admins/providers had already made in the interim — acceptable, since rollback is an exceptional path, not a routine one, and this plan's additive-only schema design is specifically chosen to keep that cost as low as it can be.

### Preserving current marketplace behavior during rollout

The keyword-match bridge (`getServices()`'s `categoryKeyword` filter, shipped in the UX/Navigation Remediation) **remains fully functional and unmodified through Stages 1–2**. Nothing about adding nullable columns or an admin picker changes what `/services?category=<slug>` does today. Stage 3 is the only stage that changes marketplace *filtering* behavior, and it does so via the compatibility path defined in §6, not a hard cutover.

---

## 3. Admin Experience

Minimum functionality only — no new generic CMS, no new form-builder abstraction (explicitly out of scope, matching this plan's own instruction and `ROADMAP.md`'s Cross-cutting Form Builder note that generalization is a post-Phase-2 decision, not assumed here).

### Assign a category to a service

Extend the existing admin service edit action (`src/lib/admin/update-service.ts`) with two new optional fields, `categoryId`/`subCategoryId`, following that file's own existing pattern exactly: same validation style (`isValidUuid` check), same transactional update, same `recordAuditEvent()` call (extending its `newValue`/`previousValue` payload to include the category change) — not a new action file, not a new pattern, per `ARCHITECTURE_PRINCIPLES.md` Principle 18 (composition/consistency over duplication). The provider-facing self-service edit action (`src/lib/provider/update-service.ts`) gets the equivalent, mirroring how that file already mirrors the admin one (per its own existing header comment).

### Assign an optional subcategory

Same action, same call — `subCategoryId` is simply the second optional field alongside `categoryId`, not a separate assignment step or a separate action.

### Validate category/subcategory consistency

Before writing, the action fetches the candidate `SubCategory` (if `subCategoryId` is provided) and confirms its `categoryId` equals the submitted `categoryId` — rejecting the update with a new, dedicated error code (e.g. `SUBCATEGORY_CATEGORY_MISMATCH`, added to `service-admin-errors.ts` / the provider equivalent) if not. This is the application-layer invariant named in `ADR-0014` and §1 above.

### Display assigned taxonomy in admin service views

The admin service list (`src/lib/admin/get-services.ts`) and detail (`get-service-detail.ts`) queries add `category`/`subCategory` to their existing `include`, and the corresponding page components render the bilingual name (via `extractLocalizedText()`) as a plain label — reusing the exact display pattern already used for `provider.businessName` in the same views, not a new UI pattern.

### Category/subcategory picker UI

A plain `<select>` populated from `getCategories()` (Phase 1.1's existing read query, already used by the admin Category pages) — filtered to `PUBLIC`/effectively-visible categories by default, matching how the provider-facing service form already filters its own dropdowns (e.g. Provider selection in `service-filters.tsx`). The subcategory `<select>` is populated client-side from the chosen category's children (a small, already-fetched list — no new client-side data-fetching mechanism needed, since `getCategories()` can eagerly include `subCategories` the same way `Category`'s own admin list page already does).

---

## 4. Marketplace Experience

### Homepage category cards (`categories-section.tsx`) and dashboard tiles (`category-explorer.tsx`)

Once Stage 1's slugs are reconciled against real `Category`/`SubCategory` rows (see below), both components' hardcoded `{key, slug, icon}` arrays are replaced by a real query — `getCategories()` filtered to effectively-visible (`PUBLIC`, or currently-`SCHEDULED`-and-past-due) top-level categories, ordered by `sortOrder`. Each card links to `/services?category=<real Category.slug>` exactly as today — the URL shape is unchanged, only what populates the card list and what the slug resolves to changes. Icon assignment (currently a hardcoded `lucide-react` icon per hardcoded slug) has no schema-level equivalent yet; this plan proposes keeping a small slug→icon lookup map as a presentation-only concern (not a new schema field) unless a future phase decides categories need their own icon/image field — not decided here.

**Slug reconciliation task (Stage 1):** the UI's current hardcoded slugs (`desert-safari`, `mountains`, `transport`, etc.) were invented for the keyword bridge and are not guaranteed to match whatever slugs admins have actually created for real `Category` rows via the Phase 1.2 admin UI. Reconciling this — deciding whether existing admin-created categories are renamed/re-slugged to match the UI's existing set, or the UI is rebuilt from whatever categories actually exist — is real product decision work belonging to Stage 1, not assumed by this plan.

### Services list filters (`service-filters.tsx`)

The existing category chip and hidden input (shipped in the UX/Navigation Remediation) are preserved as UI patterns — only what they carry changes: `currentCategory` becomes a real `Category.slug`, `currentCategoryLabel` is resolved from `Category.name` (via `extractLocalizedText()`) instead of a translation-key switch. A new, parallel `currentSubCategory`/`currentSubCategoryLabel` pair is added, rendered as its own chip (after the category chip, before search — mirroring the existing chip-ordering convention), with its own hidden input, so a selected subcategory survives other filter submissions exactly as category already does.

### Selected category / subcategory chips

Both chips remain independently removable (clicking one clears only that filter, exactly like every other chip today) — clearing `category` also clears `subCategory` if one was set (a subcategory without its parent category selected is a meaningless filter state), mirroring how clearing a parent selection should cascade; clearing only `subCategory` while keeping `category` is a valid, supported state.

### URL query parameters

`?category=<slug>` (unchanged shape) plus a new `&subCategory=<slug>` — both plain, human-readable, bookmarkable, SEO-safe query parameters, consistent with the existing `q`/`minPrice`/`maxPrice`/`providerId`/`sort` convention already in `service-filters.tsx`. No opaque IDs in the URL — slugs only, matching how `Category`/`SubCategory` already expose real unique slugs for exactly this purpose.

### Arabic and all supported locales

No change to the routing mechanism (`@/i18n/navigation`'s locale-aware `Link`/`redirect`, already used throughout) — only the *label resolution* changes, from a translation-key switch to `extractLocalizedText(category.name, locale)`. This is strictly simpler than today's mechanism (no per-locale translation key to maintain per category, since `Category.name` already carries both `ar`/`en` — though only `ar`/`en` are populated per BR-016's static-UI-vs-dynamic-content distinction; the other 6 supported locales fall back exactly as `extractLocalizedText()` already does elsewhere for admin-authored content).

### Empty states

Unchanged UX pattern (`"No results match your search"`), but now backed by a real, indexed query rather than a keyword guess — meaning an empty state after this plan ships means "no `PUBLISHED` service is currently assigned to this category," a stronger and more honest guarantee than today's "no service's name happened to contain this word."

### Filter persistence

Unchanged mechanism — the existing `hrefWithout()` / hidden-input / `Pagination`'s generic `searchParams` passthrough (already documented as automatically preserving any key present in `params`) requires no structural change; `subCategory` is simply one more key flowing through the same pipes `category` already does.

### SEO-safe URLs

Already satisfied by the existing plain-`<form method="get">` / query-string architecture — no client-side routing, no fragment-based state, fully crawlable. This plan does not change that property, only what the `category`/`subCategory` values mean.

---

## 5. Query Layer

### `getServices()` changes

Replace `categoryKeyword?: string` (temporary) with `categoryId?: string` and `subCategoryId?: string` (relational). The `where` clause's `matchConditions` array (today holding `search` and `categoryKeyword`'s bilingual `OR` clauses) drops the `categoryKeyword` branch and instead adds plain equality filters at the top level of `where`:

```ts
const where = {
  status: "PUBLISHED" as const,
  ...(filters.providerId ? { providerId: filters.providerId } : {}),
  ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
  ...(filters.subCategoryId ? { subCategoryId: filters.subCategoryId } : {}),
  ...(matchConditions.length > 0 ? { AND: matchConditions } : {}),
};
```

This is simpler than today's bilingual `OR` construction for category (no JSON path matching needed — a plain indexed foreign-key equality check), while `search` keeps its existing bilingual `OR` mechanism unchanged, since `Service.name` matching is a genuinely different concern from category membership.

### Category filtering by relational ID/slug

The services page resolves the incoming `?category=<slug>` query param to a `Category.id` via a single `getCategoryBySlug()`-style read (new, small query function, mirroring the existing `getCategoryDetail()` shape) before calling `getServices({categoryId: ...})` — the URL stays slug-based (human-readable, stable) while the query layer filters by ID (indexed, unambiguous), exactly the same slug-to-ID resolution pattern already used for Category admin detail pages today.

### Subcategory filtering

Same pattern — `?subCategory=<slug>` resolves to a `SubCategory.id`, passed as `subCategoryId`. If both `category` and `subCategory` are present, both filters apply (a service must match both — an `AND`, not an `OR`), consistent with how every other pair of simultaneous filters in this query already composes.

### Composing with search, price, location, status, and availability

No structural change to composition — `categoryId`/`subCategoryId` join the existing flat `where` object (via plain equality, not the `matchConditions` array, since they need no `OR`-across-languages treatment), while `search` keeps using `matchConditions`, and `priceWhere` keeps its existing separate `prices.some(...)` join, merged into `fullWhere` exactly as today. No location/availability filter exists yet in `getServices()` today (confirmed absent — `get-services.ts`'s own long-standing "NOT IMPLEMENTED, FLAGGED" comment about governorate filtering) — this plan does not invent one; it only guarantees `categoryId`/`subCategoryId` compose cleanly with whatever filters already exist and whatever is added later, by keeping them as plain top-level `where` keys rather than a special-cased branch.

### Avoiding N+1 queries

Category/SubCategory names for chip labels are resolved via the single slug→ID lookup already described above (one extra query per request, not per-service) — never by looping over the returned `services` array and querying each one's category individually. The existing `findMany({include: {provider: true, prices: {...}}})` call gains `category: true, subCategory: true` in the same `include` object if service-level category display is ever needed in a list view (e.g. showing each result's category badge) — a single joined query, not N+1, mirroring how `provider: true` is already included today.

### Required database indexes

`@@index([categoryId])` and `@@index([subCategoryId])` on `Service` (already specified in §1) — both are the columns this query layer filters on directly, mirroring the existing `@@index([status])`/`@@index([providerId])` precedent on the same model.

---

## 6. Backward Compatibility

### When the compatibility fallback is used

The existing `categoryKeyword` keyword-match path in `getServices()` is **not deleted in Stage 1–3**. It remains available as a fallback specifically for services with `categoryId = NULL` (i.e., not yet assigned) during the rollout window — so that a category page doesn't regress from "some honestly-matched results" to "zero results" the moment relational filtering ships, purely because backfill isn't complete yet. Concretely: `getServices({categoryId, categoryKeywordFallback})` would run the relational filter as the primary path and, only if the caller explicitly opts in during the transition window, additionally surface keyword-matched unassigned services in a clearly-separated section (not silently merged into the same result set, so a customer is never confused about why an item appeared).

### How it is monitored

A simple, low-cost signal: log (via the existing `logger` utility, same pattern as every other structured log call in this codebase) whenever the fallback path actually returns a non-empty result set during the transition window — this surfaces, without new tooling, which categories still have unassigned services worth prioritizing in the admin bulk-assignment pass (§2).

### When it is removed

Proposed removal criterion: once the admin bulk-assignment pass (§2) reports zero `PUBLISHED` services with `categoryId = NULL` for two consecutive weekly checks (a manual admin-run query, not new automated tooling — this plan does not propose building a monitoring dashboard for a one-time migration concern). Removal itself is Stage 4's job (see §7) — deleting `categoryKeyword` from `ServiceListFilters`, the `matchConditions` branch that built its `OR` clause, and this plan's fallback-surfacing logic, restoring `getServices()` to a single, simple relational filter.

### How tests prove no category links break during migration

- Stage 1: schema/migration tests confirm the new columns are nullable, indexed, and that the subcategory-parent-mismatch validation rejects an inconsistent pair (unit test on the assignment action, not a database trigger test, since the invariant lives in application code).
- Stage 2: admin/provider assignment-action tests (mirroring `update-service.test.ts`'s existing structure) cover: successful assignment, successful subcategory assignment, mismatch rejection, audit-log entry shape.
- Stage 3: `getServices()` tests (extending `get-services.test.ts`, written in the UX/Navigation Remediation) add cases for `categoryId`/`subCategoryId` filtering, composition with `search`/price/provider, and — critically — a regression test proving a service with `categoryId = NULL` is correctly excluded from a category-filtered query but still appears in an unfiltered one (the exact "uncategorized services are handled correctly" behavior from §2).
- Stage 4: a final regression pass re-running every test written in Stages 1–3 plus the existing UX/Navigation Remediation's own category tests (`service-filters.test.tsx`, `categories-section.test.tsx`) updated to assert against real `Category` fixtures instead of the hardcoded slug arrays — proving the removal of the keyword bridge did not silently change any currently-passing behavior.

---

## 7. Proposed Implementation Stages

Each stage is independently reviewable, testable, and stops for explicit approval before the next begins, per `EXECUTION_CONTRACT.md` (EC-001) — exactly as every other phase in this project already operates. None of these may begin without that separate approval; this document is scoping only.

### Stage 1 — Schema and Migration Foundation

**Scope:** Add `Service.categoryId`/`subCategoryId` (nullable) + indexes + migration. Reconcile the homepage/dashboard hardcoded slugs against real admin-created `Category`/`SubCategory` rows (§4's "slug reconciliation task") — a product decision, recorded in this plan's own follow-up or a short dated decision note, not silently assumed.
**Exclusions:** No admin UI changes yet. No query-layer changes yet (keyword bridge keeps running unmodified). No marketplace-facing behavior change.
**Files likely affected:** `prisma/schema.prisma`, `prisma/migrations/<new>/`, `docs/project-memory/15-DATA-DICTIONARY.md` (Service/Category/SubCategory entries updated to "Real" for the relationship).
**Tests required:** Migration applies cleanly against seeded data (existing services get `NULL`, no data loss). A small schema-shape test (mirroring how other Prisma model changes in this project are typically verified) confirming nullability and index presence.
**Acceptance criteria:** Migration runs cleanly in a fresh dev database and against seed data with zero errors; no existing test in the full suite regresses; `Service.categoryId`/`subCategoryId` are queryable and both `NULL` for every existing seeded service.
**Rollback:** `DROP COLUMN` on both fields — additive-only, no other column touched, no data loss beyond the (not-yet-populated) new columns themselves.

### Stage 2 — Service Assignment and Admin Support

**Scope:** Extend `update-service.ts` (admin) and its provider-facing mirror with `categoryId`/`subCategoryId` fields + mismatch validation + audit-log extension (§3). Admin service list/detail views display assigned taxonomy. Category/subcategory `<select>` picker UI.
**Exclusions:** No marketplace-facing filtering change yet (customers still see the keyword-bridge behavior). No bulk-assignment tooling beyond the admin UI itself (no CSV import, no scripted backfill — out of scope per "do not over-engineer").
**Files likely affected:** `src/lib/admin/update-service.ts`, `src/lib/provider/update-service.ts`, `src/lib/admin/service-admin-errors.ts` (+ provider equivalent), `src/lib/admin/get-services.ts`, `src/lib/admin/get-service-detail.ts`, corresponding admin page components, 8-locale translation additions for any new field labels/errors.
**Tests required:** Assignment success/failure paths (mirroring `update-service.test.ts`'s existing structure), mismatch-rejection test, audit-log shape test, admin list/detail display test.
**Acceptance criteria:** An admin can assign/change/clear a service's category and subcategory through the UI; an inconsistent category/subcategory pair is rejected with a clear error; every assignment is audit-logged; no existing service-management test regresses.
**Rollback:** Revert the action/UI changes — no schema change in this stage, so rollback is a pure code revert with zero data-migration concern.

### Stage 3 — Relational Marketplace Filtering

**Scope:** `getServices()` gains `categoryId`/`subCategoryId` filters (§5). Homepage/dashboard category cards query real `Category` rows (§4). `service-filters.tsx` gains the subcategory chip/hidden-input. Slug-to-ID resolution for both category and subcategory. Compatibility fallback (§6) active for still-unassigned services.
**Exclusions:** The keyword bridge is not yet deleted — it remains as the defined fallback for unassigned services. No removal of `categoryKeyword` from `ServiceListFilters` yet.
**Files likely affected:** `src/lib/services/get-services.ts`, `src/app/[locale]/services/page.tsx`, `src/components/services/service-filters.tsx`, `src/components/landing/categories-section.tsx`, `src/components/dashboard/category-explorer.tsx`, new small `get-category-by-slug.ts`-style query function, translation additions for the subcategory chip label.
**Tests required:** All of §6's Stage 3 test cases (relational filter composition, `NULL`-category exclusion/inclusion correctness, fallback-surfacing behavior). Updated/extended versions of the UX/Navigation Remediation's own tests (`get-services.test.ts`, `service-filters.test.tsx`, `categories-section.test.tsx`).
**Acceptance criteria:** Clicking a homepage/dashboard category card filters the marketplace by a real `Category` row; subcategory filtering works end to end; both chips render, are independently removable, and compose correctly with search/price/provider/sort; unassigned services are excluded from category-filtered views but still appear elsewhere; Arabic and all 8 locales render correctly; live browser verification (per this project's standing verification workflow) confirms no nested `<a>`, correct RTL, correct empty states.
**Rollback:** Revert the query-layer/UI changes back to the keyword-bridge-only behavior — since Stage 1/2's schema and admin changes are additive and independent, rollback of Stage 3 alone does not require touching them.

### Stage 4 — Compatibility Removal and Hardening

**Scope:** Delete the `categoryKeyword` field, its `matchConditions` branch, and the fallback-surfacing logic from `getServices()`. Remove the now-dead `LANDING_CATEGORY_SLUGS`/`DASHBOARD_CATEGORY_SLUGS` switch statements from `services/page.tsx` (superseded by real `Category.name` resolution in Stage 3). Final regression pass (§6's Stage 4 test description). Update `docs/project-memory/07-CATEGORIES.md`, `13-OPEN-QUESTIONS.md`, and `17-CHANGELOG-DECISIONS.md` to reflect the closed gap.
**Exclusions:** No new marketplace features (Discovery/Search/Featured/Campaigns/Recommendations remain `ADR-0013`'s named future Marketplace responsibilities, not this stage's job). No `NOT NULL` database constraint tightening (remains an explicitly separate, not-yet-scheduled future decision per `ADR-0014`'s Open Question #3).
**Files likely affected:** `src/lib/services/get-services.ts`, `src/app/[locale]/services/page.tsx`, the test files from Stages 1–3, the project-memory files named above.
**Tests required:** Full regression suite pass (no test from any prior stage broken by the removal). A deliberate negative test proving the old `categoryKeyword` field no longer exists on `ServiceListFilters` (a type-level check, or simply the removal being visible in the diff and covered by `tsc --noEmit` passing cleanly).
**Acceptance criteria:** Zero remaining references to keyword-based category matching anywhere in the codebase; the removal criterion from §6 (two consecutive weekly zero-`NULL`-category checks) was actually met before this stage began, not assumed; full verification suite (`tsc`, `eslint`, `vitest`, `next build`) passes; live browser re-verification confirms category/subcategory filtering still works identically post-removal.
**Rollback:** Re-add the removed code from version control (git history) if the removal criterion turns out to have been measured incorrectly — this is why the removal criterion is deliberately conservative (two consecutive clean checks, not one).

---

## Cross-references

- `docs/08-governance/adr/ADR-0014-service-category-relational-taxonomy.md` — the architectural decision this plan implements (Draft, pending approval).
- `docs/plans/ROADMAP.md` — Phase 3 (Service Engine), where this work is folded in as detail.
- `docs/project-memory/07-CATEGORIES.md` — the "remaining design question" this plan (and `ADR-0014`) answers.
- `docs/project-memory/15-DATA-DICTIONARY.md` — `Category`, `SubCategory`, `Service` entity entries, each naming category assignment as a planned extension this plan schedules concretely.
- `src/lib/services/get-services.ts` — the temporary keyword-match bridge this plan retires (Stage 4).
