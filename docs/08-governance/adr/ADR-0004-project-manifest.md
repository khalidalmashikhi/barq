# ADR-0004: Introduce PROJECT_MANIFEST.md Above BARQ_BIBLE.md

- **Purpose:** Record the decision to introduce a new root document, `PROJECT_MANIFEST.md`, positioned structurally and philosophically above `BARQ_BIBLE.md` in the documentation architecture.
- **Scope:** The existence, authority, and boundary of `PROJECT_MANIFEST.md` relative to `BARQ_BIBLE.md`. Not the content of either document beyond what's needed to justify the boundary.
- **Out of Scope:** The specific content of `BARQ_BIBLE.md` (still pending, per the Phase 0 order established in ADR-0003).
- **Dependencies:** `ADR-0001` (documentation architecture), `ADR-0003` (documentation order — establishes `BARQ_BIBLE.md` is written only after Phase 0 is approved).
- **Status:** Approved v1.0 — Locked upon acceptance of this ADR.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## Context

`BARQ_BIBLE.md` was originally scoped (in earlier planning) as the master charter — mission, personas, business model summary, platform pillars, and a documentation index. In practice, this conflates two different kinds of statement:

1. Statements that are **permanent** — true regardless of what BARQ builds, what market it's in, or what year it is (e.g. "trust is the product," "Arabic-first is an identity commitment, not a checkbox").
2. Statements that are **operational** — true for BARQ *today*, but expected to evolve as the platform grows (e.g. which capabilities exist, which documents are approved, current platform pillars).

Conflating these means that every time the Bible needs an operational update — a new pillar, a new capability doc added to the index — it also touches the same document that's supposed to hold the project's unchanging identity. Over time, this either freezes the operational parts (bad — the Bible should stay current) or erodes the permanence of the identity parts (worse — the whole point of having a stable "why" is that it doesn't get diluted by routine edits).

## Decision

Introduce `PROJECT_MANIFEST.md` as a new root document, positioned **above** `BARQ_BIBLE.md`:

- `PROJECT_MANIFEST.md` — the constitution. Purpose, Vision, Mission, Core Values, Product/Engineering/AI/Design Philosophy, Customer Promise, Provider Promise, Quality Standard, Decision Framework, Long-Term Vision. Intended to remain stable for the life of the project. Changed only through the highest-tier ADR review, essentially never as a routine update.
- `BARQ_BIBLE.md` — the operational charter. Translates the Manifest's philosophy into current platform structure: personas, business model summary, platform pillars, documentation index with live status. Expected to change as the platform grows, but only in ways that remain consistent with the Manifest above it.

Authority flows one direction only: `PROJECT_MANIFEST.md` constrains `BARQ_BIBLE.md`; `BARQ_BIBLE.md` may never contradict it. If a future Bible update would conflict with the Manifest, the Manifest wins, and the conflict is resolved via ADR before the Bible is edited.

## Alternatives Considered

- **Keep everything in `BARQ_BIBLE.md`.** Rejected — this is the status quo problem described above; it will cause exactly the constitution/operations conflation this ADR exists to prevent.
- **Fold the Manifest's content into `PROJECT_RULES.md`.** Rejected — `PROJECT_RULES.md` is an operational rules document (Phase 0, not-yet-written) governing how documentation and engineering work happen day to day. It is itself subordinate to and derived from the Manifest's Engineering Philosophy, not a substitute for it.
- **Make the Manifest a section inside `BARQ_BIBLE.md` rather than a separate file.** Rejected — a section inside a document that changes regularly is not meaningfully protected from that document's own edit cadence. Separation is what gives the Manifest its stability guarantee.

## Consequences

- **Positive:** BARQ's identity is now protected from routine documentation churn. Every future document can trace its reasoning upward to a stable "why" instead of an operational document that shifts under it.
- **Positive:** Gives the Decision Framework (Manifest §12) a permanent home that any future contributor — human or AI agent — can be pointed to when a decision is ambiguous.
- **Negative / Cost:** One more root document to maintain awareness of; documentation architecture diagrams and onboarding material must now explain two root documents instead of one.
- **Follow-up required:** `BARQ_BIBLE.md`, when written (post Phase 0, per `ADR-0003`), must explicitly state its subordinate relationship to `PROJECT_MANIFEST.md` and must not duplicate Manifest content — it links to the Manifest rather than restating it, per the SSOT rule.

## Documentation Architecture Update

Root-level documents are now:

```
/
├── PROJECT_MANIFEST.md      ← NEW. Root of authority. Constitution.
├── BARQ_BIBLE.md            ← Subordinate to the Manifest. Not yet written (Phase 0 pending).
├── README.md
├── CHANGELOG.md
├── PROJECT_STATUS.md
└── docs/...
```

No other structural change to `docs/` is introduced by this ADR.

---

## Related Documents
- `PROJECT_MANIFEST.md` — the document this ADR authorizes and positions
- `ADR-0001-documentation-architecture.md` — original documentation architecture, now amended by this ADR's root-level update
- `ADR-0003-documentation-order.md` — establishes Phase 0 and that `BARQ_BIBLE.md` follows it
- `BARQ_BIBLE.md` *(not yet written)* — must reference this ADR when written

## Open Questions
- None at this time. This ADR resolves the structural question it was raised to answer.

## Future ADR References
- Any future proposal to alter the authority relationship between `PROJECT_MANIFEST.md` and `BARQ_BIBLE.md` must supersede this ADR explicitly, not silently.
