# ADR-0016 — BARQ v1 Marketplace Taxonomy (approved customer-facing category set)

- **Purpose:** Record the approved, customer-facing BARQ **v1 marketplace taxonomy** — the concrete root/child categories that go live for discovery — as a data/curation decision layered on top of the taxonomy *architecture* frozen by `ADR-0015`. This ADR chooses *which categories exist*; it does not change *how* categories work.
- **Scope:** The customer-facing v1 category set only: four roots, four `Tours & Experiences` children, their bilingual labels, slugs, and `serviceTypeKey` mapping; and the decision to archive two junk staging categories (slugs `1`/`2`). Also records the staging bootstrap mechanism that materializes this set.
- **Out of Scope (unchanged, not touched here):** the `ADR-0015` taxonomy architecture (self-referential `Category` tree, `Category.serviceTypeKey`, `Service.categoryId`, `ProviderCategory`, ServiceType spine) — all preserved exactly; the Vehicle/Asset domain (NOT introduced); Dynamic Provider Fields; pricing/commission/payment; booking; the `Service.serviceType` ↔ `Category.serviceTypeKey` reconciliation (**BR-028 remains deferred to P4**); accommodation/restaurant verticals (deliberately not part of v1).
- **Dependencies:** `ADR-0015-servicetype-spine-and-taxonomy-v2.md` (this ADR supplies the concrete v1 instance of that model and amends its *illustrative canonical list*, not its architecture), `ADR-0014`, `ADR-0013` (Marketplace BC #16 owns Category), `ADR-0005` (bilingual JSON labels), `ADR-0012` (phase-order freeze this fits inside).
- **Status:** Accepted. Amends the canonical-taxonomy *content* referenced by `ADR-0015` §Decision; the frozen architecture of `ADR-0015` is unchanged and not re-opened.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

`ADR-0015` froze the taxonomy *architecture* and seeded an *illustrative* canonical list (`tours`, `transport`, `camping`, `beaches`, `diving`, `photography`, `mountains`, `accommodation`, `restaurants`, `activities`) via `prisma/seed.ts`. That list was a nature/activity catalogue, not a marketplace-first, provider-service catalogue, and it was never populated on staging (staging carried only two junk PUBLIC roots with slugs `1`/`2` from manual testing). A marketplace-direction review produced a smaller, sharper, service-oriented v1 set. Because `ADR-0015` is Frozen, that content change is recorded here as an explicit amendment rather than an ad-hoc seed edit.

## Decision

**1. The approved v1 roots (PUBLIC, in this discovery order):**

| # | EN | AR | slug | serviceTypeKey |
|---|----|----|------|----------------|
| 1 | Car Rentals | سيارات للإيجار | `cars` | `RENTAL` |
| 2 | Tours & Experiences | جولات وتجارب | `tours-experiences` | `EXPERIENCE` |
| 3 | Marine Trips | رحلات بحرية | `marine-trips` | `EXPERIENCE` |
| 4 | Transfers | نقل وتوصيل | `transfers` | `TRANSPORT` |

**2. The four `tours-experiences` children (depth-1, PUBLIC, inheriting `EXPERIENCE` per BR-023):**

| EN | AR | slug |
|----|----|------|
| Tourist Guides | مرشدون سياحيون | `tourist-guides` |
| Adventures | مغامرات | `adventures` |
| Local Experiences | تجارب محلية | `local-experiences` |
| Cultural Tours | جولات ثقافية | `cultural-tours` |

**3. Why fewer roots.** Discovery clarity is a first-cut product goal (a new customer must, within seconds, see *what they can book* and *where to tap*). Five overlapping EXPERIENCE roots (guides / adventures / local / marine / tours) blur that choice for both customers and providers picking a category. Collapsing the three most overlapping into children of one `Tours & Experiences` root keeps four clean top-level choices while preserving the finer distinctions one level down — using the depth-2 tree `ADR-0015` already supports, with no architectural change.

**4. Relational architecture preserved.** These are ordinary `Category` rows in the existing self-referential tree. `Service.categoryId` (the relational FK) and `ProviderCategory` (areas of activity) are unchanged; the customer-facing dual read in `services/page.tsx` resolves these slugs to the relational `categoryId` filter exactly as designed. No schema change, no new field, no new table.

**5. `serviceTypeKey` mapping is governed by the code registry** (`EXPERIENCE`, `TRANSPORT`, `ACCOMMODATION`, `DINING`, `EVENT`, `RENTAL`). `cars → RENTAL` is valid at the taxonomy layer. **This does NOT introduce the Vehicle/Asset domain** — a car-rental *listing* is an ordinary `Service` under the `cars` category; the fact that `create-service.ts` still stores `serviceType = EXPERIENCE` on every service is the pre-existing, deferred **BR-028** reconciliation and is out of scope here.

**6. Junk cleanup.** The two staging categories with slugs `1`/`2` are archived (`visibilityStatus → ARCHIVED`, the transition `category-visibility-policy` already permits) **only after proving** they have zero `Service`, `ProviderCategory`, and child-category dependencies. They are never hard-deleted (`onDelete: Restrict`); if any dependency is found the archive is refused and reported.

**7. Materialization mechanism.** A staging-only, idempotent bootstrap (`scripts/bootstrap-staging-taxonomy.ts` + testable core `src/lib/categories/staging-taxonomy-bootstrap.ts`) creates this set. It refuses unless `APP_ENV=staging`, is dry-run by default (`--apply` to execute), uses INSERT-IF-ABSENT upserts that never overwrite an admin-edited row (`ADR-0015` §6), and reuses the domain's own rules (`isValidServiceTypeKey`, `MAX_CATEGORY_DEPTH`, the create-category slug pattern, the visibility transition rule). The Admin Category UI remains the primary production channel; this bootstrap is a one-time staging convenience, not a production seed. **`prisma db seed` is deliberately NOT used for staging** (it would create demo providers/services/bookings — fabricated inventory).

## Consequences

**Positive:** a clear, marketplace-first v1 taxonomy; four sharp top-level choices; finer facets preserved as children; zero architecture/schema change; a safe, re-runnable, auditable population path; junk removed without data loss.

**Negative / Cost:** the `ADR-0015` illustrative canonical seed list now diverges from the live v1 set (recorded here on purpose; the seed is not edited under this ADR). `Service.serviceType` still reads `EXPERIENCE` for `cars`/`transfers` listings until BR-028 is addressed (P4) — a cosmetic classification gap, not a discovery/booking defect.

## Alternatives Considered (rejected)

- **Use the `ADR-0015` illustrative canonical list as-is** — rejected: nature/activity-oriented, not the marketplace-first service catalogue BARQ v1 needs.
- **All seven categories as flat roots** — rejected: five overlapping EXPERIENCE roots dilute the 3-second discovery clarity goal.
- **Edit `prisma/seed.ts` directly** — rejected as the primary channel: `ADR-0015` is Frozen and designates the Admin UI as the production channel; an ADR-recorded decision + a guarded, idempotent staging bootstrap is the auditable path. Syncing fresh environments via a ledger-tracked data migration remains a separate, future decision.
- **Hard-delete the junk `1`/`2` categories** — rejected: `onDelete: Restrict` + archive-not-delete is the safe, reversible, audited operation.

## Related Documents

`ADR-0015`, `ADR-0014`, `ADR-0013`, `ADR-0012`, `ADR-0005`; `docs/project-memory/01-CURRENT-STATE.md`, `07-CATEGORIES.md`, `16-BUSINESS-RULES.md` (BR-023–BR-028); `scripts/bootstrap-staging-taxonomy.ts`, `src/lib/categories/staging-taxonomy-bootstrap.ts`.
