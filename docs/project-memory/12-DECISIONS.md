# 12 — Decisions Log

A running log of real, **granular/tactical** decisions made during implementation work — the "we chose X over Y for this specific reason" calls made *while building something*, in the spirit of `docs/08-governance/DEVELOPMENT_LOG.md`. Append to this file as new decisions are made — do not rewrite history in it.

**Scope split from `17-CHANGELOG-DECISIONS.md`**: this file is for implementation-detail decisions (a schema shape choice, an enum reuse, a file-organization call) made in service of a larger goal. `17-CHANGELOG-DECISIONS.md` is for the higher-level architectural/product decisions those tactical choices serve (a new ADR, a product-direction commitment). If a decision here was made *in service of* a `17-CHANGELOG-DECISIONS.md` entry, link to it rather than re-explaining the higher-level context.

## Entry format

```
### YYYY-MM-DD — Short decision title
**Context:** why this came up
**Decision:** what was decided
**Alternative(s) considered:** what else was on the table, and why it lost
```

---

### (project-memory phase) — Reuse `BookingActorType` for the new `AuditLog` model rather than a new enum
**Context:** Phase 5.2 added a general `AuditLog` model for admin/provider mutations. See BR-019 in `16-BUSINESS-RULES.md` and the `AuditLog` entity in `15-DATA-DICTIONARY.md` for the resulting rule/entity this decision produced.
**Decision:** Reused the existing `BookingActorType` enum (`CUSTOMER`/`PROVIDER`/`SYSTEM`/`ADMIN`) rather than defining a duplicate, identically-shaped enum under a more generic name.
**Alternative considered:** A new `AuditActorType` enum — rejected as unnecessary duplication (DRY) since the existing enum's values are already generic actor-kind values despite its booking-era name.

### (project-memory phase) — `docs/project-memory/` created as a 13th, deliberately un-numbered `docs/` subdirectory
**Context:** No AI-agent-facing memory system existed; the 12 numbered `docs/` subdirectories are ADR-gated and versioned, which is the wrong update cadence for living working memory.
**Decision:** New `docs/project-memory/` sits alongside the numbered directories, explicitly exempt from the ADR/RFC gate — update it freely as things are learned.
**Alternative considered:** Making it `docs/12-project-memory/` to match the numbering convention — rejected because that would visually imply it's part of the same versioned/frozen documentation register, which it deliberately is not.

### (project-memory phase) — Category model design deferred, not started
**Context:** The product direction calls for a full category/visibility system (planned engine #2), but no schema design has been done yet.
**Decision:** Documented the target state (`07-CATEGORIES.md`) and open design questions (`13-OPEN-QUESTIONS.md`) without proposing a schema — this phase is documentation-only by explicit instruction.
**Alternative considered:** Sketching a draft `Category` model now — rejected; schema design belongs in a dedicated, separately-approved implementation phase, not folded into a memory-scaffolding phase.

### 2026-08-12 — Core Service Enrichment (Gate 3): `Service.regionCode` + `Price.pricingUnit` wired as domain read/write only
**Context:** Gate 2 (local commit `1fde9db`, migration `20260812120000_service_region_pricing_unit`, still UNAPPLIED) added two nullable columns: `Service.regionCode` (broad Oman **governorate** where a service operates — a discovery/filter facet) and `Price.pricingUnit` (the display basis of `amount`). Gate 3 wires application read/write for them **without any UI, Explore filter, or presentation change**.
**Decision:**
- Two isomorphic code registries were added as the app-level allow-lists: `src/lib/regions` (the **11** governorate codes, mirroring the Gate-2 DB CHECK exactly) and `src/lib/pricing-units` (**5** codes: `PER_PERSON, PER_BOOKING, PER_DAY, PER_HOUR, PER_TRIP`). Both follow the `service-types/registry.ts` convention (ADR-0015: String codes, not Prisma enums) and each exposes a `parseRegionCode`/`parsePricingUnit` three-state helper (`null` = unset, code = valid, `undefined` = invalid).
- `regionCode` is a **governorate-level discovery facet only** — NOT a location/geography system. There is deliberately **no** wilayat/city/map/lat-lng/meeting-point/route/PostGIS, and **no** Vehicle/Asset entity.
- `pricingUnit` is **display/commercial metadata ONLY**. It rides the *same* ACTIVE `Price` row as `amount`/`currency` in every reader and **does not affect totals or booking behaviour** — nothing multiplies by it, `Booking` was not touched, no `priceSnapshotUnit` was added, and `createBooking`/payment/refunds are unchanged. On update it is set via a metadata-only `updateMany` on the ACTIVE price(s) — never a new Price row (append-only price versioning preserved, no duplicate ACTIVE price).
- The DB intentionally has **no** CHECK on `pricingUnit` (commercially extensible), so `src/lib/pricing-units` is its *only* allow-list; `regionCode` keeps its DB CHECK as defence-in-depth.
- Invalid `regionCode`/`pricingUnit` reuse the existing `INVALID_INPUT` error (Gate-4 UI will be dropdowns, so an invalid value is a malformed/spoofed request) rather than adding new error codes + 8-locale i18n keys.
- Update semantics: for these freely-nullable fields, an **absent** form field leaves the value unchanged while a **present-but-empty** field clears it to NULL — deliberately different from `categoryId`'s "empty = leave unchanged" (a category is required at publish and must never be silently nulled). All readers/actions are NULL-tolerant for legacy rows; no backfill.
**Alternative(s) considered:** Dedicated `INVALID_REGION`/`INVALID_PRICING_UNIT` error codes (rejected: needs new codes + translation keys across 8 locales for a spoof-only path); mutating/versioning a new Price row to change `pricingUnit` (rejected: it is metadata, not a price change); giving `pricingUnit` a DB CHECK (rejected in Gate 2 for commercial extensibility).
