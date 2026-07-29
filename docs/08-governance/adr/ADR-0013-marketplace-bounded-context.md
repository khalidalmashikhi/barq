# ADR-0013 — Marketplace Bounded Context (Category & SubCategory)

**Purpose:** Formally add Marketplace as Bounded Context #16 to the Locked `docs/02-domain-architecture/DOMAIN_MODEL.md`, owning the new `Category`/`SubCategory` entities Phase 1.1 (Core Business Platform) introduces. Closes the formalization gap identified in Phase 0.2's Architecture Consistency Audit: `ADR-0012` had already accepted Marketplace as future architecture, but the Locked domain model itself had not yet been amended to include it.

**Scope:** Adding Marketplace as a new Bounded Context, and `Category`/`SubCategory` as its owned entities. Nothing else in `DOMAIN_MODEL.md` changes.

**Out of Scope:** Does not touch any of the original 15 Bounded Contexts' own definitions. Does not implement Discovery, Search, Featured Services, Campaigns, or Recommendations — those remain named as Marketplace's eventual responsibilities but are not built in Phase 1.1 and are not schema/code decisions this ADR makes. Does not assign any `Service` to a `Category` — that is a Provider-facing change explicitly deferred to a later phase.

**Dependencies:** `ADR-0002-modular-monolith.md` (Bounded Context convention this ADR extends), `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md` (the prior acceptance this ADR formalizes), `docs/02-domain-architecture/DOMAIN_MODEL.md` (the document this ADR amends).

**Status:** Approved, Locked.

**Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

`ADR-0012` accepted Marketplace as a Bounded Context — owning Categories, Discovery, Search, Featured/Campaigns, Visibility, Recommendations — as documented future architecture. But acceptance in `ADR-0012` did not itself amend the Locked `DOMAIN_MODEL.md`, which governs the actual, authoritative list of Bounded Contexts per `ADR-0002`. Phase 0.2's Architecture Consistency Audit named this explicitly as a formalization gap: nothing conflicted, but Marketplace wasn't yet real in the document that matters for module-boundary purposes.

Phase 1.1 (Core Business Platform) is the first phase to actually build something that needs a home in this context — the `Category` and `SubCategory` models. Per Phase 1.1's own instructions, this amendment is made as part of this implementation phase rather than a standalone documentation phase, closing the gap at the moment code first needs it rather than speculatively beforehand.

## Architecture Decision

1. `docs/02-domain-architecture/DOMAIN_MODEL.md` gains a 16th Bounded Context, **Marketplace**, positioned after Administration (context #15):
   - **Purpose:** The browsable, categorized taxonomy tourists will discover services through.
   - **Owns:** `Category`, `SubCategory`.
   - **Does Not Own:** `Service`/`Experience` (Provider context retains full ownership) — Marketplace classifies and will surface them, it never holds their lifecycle. The Homepage page-shell remains a Content/CMS concern that *consumes* Marketplace data, not part of Marketplace itself (per `ADR-0012`'s producer/consumer framing, now made concrete).
   - **Collaborates With:** Provider (future `Service.categoryId`, not built here), Administration (Category/SubCategory management is Admin-only).
2. Two new Core Domain Entities are added: `Category` and `SubCategory`, per Phase 1.1's actual schema (bilingual name, unique slug, one of BR-004's 6 visibility states, `SubCategory` belonging to exactly one `Category`).
3. `07-CATEGORIES.md`'s previously open question — does `SubCategory` inherit or independently hold visibility — is resolved: independent field, stricter-of-the-two effective visibility. Recorded here as the entity's Business Invariant, not left open any longer.
4. This is the **first amendment** to `DOMAIN_MODEL.md` since its original Batch approval via `ARCHITECTURE_FREEZE_V1.md` — consistent with that freeze's own Exit Criteria (an ADR superseding/amending the architecture is normal evolution, not a freeze breach).

## Consequences

**Positive:** Category/SubCategory now have a real, Locked, ADR-gated home rather than living only in the un-Locked `docs/project-memory/18-DOMAIN-MODEL.md`. Closes Phase 0.2's named formalization gap at the point real code needs it, per EC-001's "documentation updates happen inside the implementation phase that introduces the change" principle.

**Negative:** Marketplace's other eventual responsibilities (Discovery, Search, Featured, Campaigns, Recommendations) are named but not detailed at the entity level — a future phase building any of those will need to extend this ADR's Bounded Context definition further, not treat it as already fully specified.

## Documentation

This ADR is accompanied by: the `DOMAIN_MODEL.md` amendment (§1 Bounded Contexts, §2 Core Domain Entities, Related Documents); one new `BARQ_BIBLE.md` ADR Index line; one new `docs/08-governance/DEVELOPMENT_LOG.md` entry (recorded as part of Phase 1.1's own report, not separately).

## Related Documents

- `docs/02-domain-architecture/DOMAIN_MODEL.md` — the document this ADR amends.
- `ADR-0002-modular-monolith.md`, `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md`.
- `docs/project-memory/07-CATEGORIES.md`, `15-DATA-DICTIONARY.md`, `18-DOMAIN-MODEL.md` — updated alongside this ADR to reflect Category/SubCategory as real, not target.

## Open Questions

None blocking. Marketplace's Discovery/Search/Featured/Campaigns/Recommendations responsibilities remain future scope, to be detailed by whichever phase actually builds them.

## Future ADR References

Any future ADR building Discovery, Search, Featured Services, Campaigns, or Recommendations under the Marketplace context should cite this ADR-0013 as the context's origin. Any future change to `Service`'s relationship with `Category` (e.g. adding `Service.categoryId`) should be recorded in the phase that builds it, citing both this ADR and `ADR-0012`'s Provider-context boundary.
