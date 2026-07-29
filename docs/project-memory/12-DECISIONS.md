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
