# 07 — Categories

## Current state (updated Phase 1.1, Core Business Platform)

**`Category`/`SubCategory` models are real** (`prisma/schema.prisma`, migration `20260723112230_category_domain`) — bilingual name, unique slug, `CategoryVisibilityStatus` (all 6 BR-004 states), admin-gated CRUD and visibility-transition Server Actions (`src/lib/categories/`). Owned by the Marketplace Bounded Context (`ADR-0013`, `18-DOMAIN-MODEL.md`).

**Not yet done, deliberately out of Phase 1.1's scope:** `Service.categoryId` assignment (a Provider-facing change), any admin UI (Phase 1.2), any customer-facing browsing/discovery (Marketplace, later phases). `Service.serviceType` remains a plain string CTI discriminator, unrelated to Category — the codebase's own comments (`src/lib/services/get-services.ts`) still warn against treating it as a category filter. The homepage's "Categories" section (`src/components/landing/categories-section.tsx`) remains a hardcoded, non-functional 6-item array, unaffected by this phase — its replacement is Phase 1.5/1.6's job (Homepage Sections).

## Category model

Categories may be in one of these visibility states:
- `PUBLIC` — visible and browsable by anyone.
- `HIDDEN` — not shown anywhere, but not deleted (data preserved).
- `LINK_ONLY` — reachable only via a direct link, not listed in navigation/browsing.
- `INVITE_ONLY` — reachable only for specifically-invited users/providers.
- `SCHEDULED` — becomes visible automatically at a future date/time.
- `ARCHIVED` — retired, kept for historical/reporting purposes.

An admin must be able to hide or activate accommodation, transport, restaurants, activities, or any category **without a code change** — real as of Phase 1.1 via `setCategoryVisibility()`/`archiveCategory()` (`src/lib/categories/transition-category-visibility.ts`), same for SubCategory.

**SubCategory visibility inheritance — resolved (Phase 1.1):** a SubCategory holds its own independent `visibilityStatus`, but its *effective* visibility is always the stricter of the two — a `HIDDEN`/`ARCHIVED` parent Category makes every child effectively invisible regardless of the child's own status (`isSubCategoryEffectivelyVisible()`, `category-visibility-policy.ts`). This was the one open design question this document previously flagged; no longer open.

## Remaining design questions (not answered by Phase 1.1)

- **How `Service.categoryId` should relate `Category` to `Service` — proposed, not yet approved (2026-07-26).** The UX/Navigation Remediation phase shipped a temporary, honestly-documented keyword-match bridge (`getServices()`'s `categoryKeyword` filter, matching a category's translated label as a substring against `Service.name`) so homepage/dashboard category cards would navigate somewhere real, precisely because this question was still open. `ADR-0014-service-category-relational-taxonomy.md` (Draft) now proposes an answer — a single nullable `Service.categoryId` + optional nullable `subCategoryId` (not a many-to-many join table) — with the full implementation plan in `../plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md`. **Neither is approved yet**; the keyword bridge remains the only real mechanism until they are.
- How does a Category relate to `Service.serviceType`'s existing CTI discriminator — does serviceType become a Category-scoped concept, or do the two stay independent? `ADR-0014` assumes they stay independent (proposed, not fully closed until implementation — see that ADR's Open Question #2).
- Category-specific provider requirements (see `05-PROVIDER-EXPERIENCE.md`) imply some kind of per-category form/document schema — this likely depends on Form Builder (planned engine #3) existing, or at least a first version of it.

Tracked as open design work, not decided here — see `13-OPEN-QUESTIONS.md` and `../plans/ROADMAP.md`. (Whether Category deserves its own Bounded Context — previously open — is resolved: yes, per `ADR-0013`, Marketplace is Bounded Context #16.)

## Related registry entries

BR-004, BR-013 in `16-BUSINESS-RULES.md`; `Category`, `SubCategory` entities in `15-DATA-DICTIONARY.md`.
