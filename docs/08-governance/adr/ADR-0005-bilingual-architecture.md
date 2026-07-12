# ADR-0005: Bilingual by Design (Arabic + English as Co-Equal Architecture)

- **Purpose:** Record the decision that BARQ is bilingual by architecture, not by localization layer — Arabic (default, Oman launch) and English (first-class, full parity) are both structural requirements affecting product, UX, AI, APIs, database design, and documentation, from day one, permanently.
- **Scope:** The architectural principle itself, its implications across each affected layer, and the standing obligations it places on all current and future documentation and features.
- **Out of Scope:** Specific implementation mechanics — i18n library choice, exact database translation-table schema, specific RTL CSS strategy. Those are owned by the documents this ADR obligates (`DATABASE_DESIGN.md`, `DESIGN_SYSTEM.md`, `API_STANDARDS.md`) once written.
- **Dependencies:** `PROJECT_MANIFEST.md` (Design Philosophy, §8 — "Arabic-first... RTL is a first-class layout mode"), `ADR-0002-modular-monolith.md` (this principle applies within every module of the monolith).
- **Status:** Approved v1.0 — Locked upon acceptance. **Superseded in part by `ADR-0010-multilingual-architecture-expansion.md`** (2026-07-11) — ADR-0010 supersedes this ADR's language-count scope only (two languages → eight officially targeted languages); every principle below (bilingual-by-design mechanics, RTL-as-first-class, no-hardcoded-text, language-neutral domain/API layer) remains fully in force and is reaffirmed, not overridden, by ADR-0010.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## Context

Localization is normally treated as a feature layered onto a finished product — translated strings swapped in, RTL patched in via CSS overrides, added after the "real" build is done. For BARQ this framing is backwards and dangerous: Arabic is the default language for the primary launch market (Oman), and treating it as an add-on all but guarantees Arabic ends up as the second-class experience while English becomes the one the architecture was actually built around — the exact inversion of the product's identity.

BARQ's `PROJECT_MANIFEST.md` already states Arabic-first is an identity commitment, not a checkbox (Core Value 4) and that RTL is a first-class layout mode (Design Philosophy, §8). This ADR is what makes that philosophy structurally enforceable rather than aspirational — it converts a value statement into binding requirements on every layer of the system.

## Decision

BARQ is bilingual by design. The following are binding architectural requirements, not feature preferences:

1. Arabic is the default customer language at launch (Oman); English is first-class with complete feature parity — neither is a fallback for the other.
2. Every customer-facing feature is considered incomplete unless both languages are fully supported. A feature with only one language is not a partial launch; it is not done.
3. All UI components must support both RTL and LTR layout modes as designed-in behavior, not mirrored-after-the-fact behavior.
4. Localization is built into the design system as a foundational constraint (spacing, typography, iconography, component direction-awareness), not layered on top of it afterward.
5. All user-facing strings are sourced from a centralized i18n system. Hardcoded text is prohibited anywhere in the application — this is a code-review-blocking rule, not a style preference.
6. APIs, business logic, database schemas, and domain models remain language-neutral. Language is a presentation-layer and content-layer concern; it must never leak into domain logic or API contracts as an implicit assumption.
7. Any multilingual data persisted in the database follows a scalable localization strategy suitable for future languages beyond Arabic and English — the specific mechanism (translation tables vs. per-locale columns vs. JSON locale maps) is decided in `DATABASE_DESIGN.md`, but it must be decided against this constraint, not against a two-language-only assumption.
8. AI Agents must understand and respond naturally in both Arabic and English — this is a functional requirement on every agent defined in `AI_STRATEGY.md` and `AI_AGENTS.md`, not an optional capability.
9. Future languages must be addable without changing application architecture — adding a third language is a content/configuration operation, never a re-engineering effort.

## Consequences

**Positive**
- Prevents the single most common failure mode in "localized" platforms: an architecture implicitly built around one language with translation bolted on, producing a permanently second-class experience in the other.
- Gives every future document a concrete, testable obligation instead of a vague aspiration — "localization acceptance criteria" becomes a real checklist, not a suggestion.
- Makes GCC expansion to any future language a configuration change, not an architectural rewrite.

**Negative / Cost**
- Every UI component, API contract, and domain model must be designed with bilingual/multi-directional support in mind from the start, which is slower upfront than shipping English-only and translating later.
- Design system work increases in scope — RTL/LTR parity must be verified for every component, not assumed.

**Follow-up Required — binding on future documents:**
- `PROJECT_MANIFEST.md` — update Design Philosophy (§8) to reference this ADR explicitly (done, this turn).
- `BARQ_BIBLE.md` *(not yet written — Phase 0 pending per ADR-0003)* — when drafted, must state bilingual-by-design as a platform pillar and cite this ADR. Cannot be marked complete without it.
- `ARCHITECTURE_PRINCIPLES.md` *(not yet written — Phase 0 pending)* — when drafted, must include "language-neutral domain/API layer" as a named principle, citing this ADR.
- `DESIGN_SYSTEM.md` *(not yet written)* — when drafted, must define RTL/LTR as foundational, not a supported mode among others, citing this ADR. Must define the UI review checklist from this ADR's requirement 14 (RTL, LTR, responsive layout in both, typography quality in both, equal UX in both).
- `AI_STRATEGY.md` *(not yet written — Phase 0 pending)* — when drafted, must state bilingual natural-language capability as a non-negotiable requirement for every AI Agent, citing this ADR.
- `DATABASE_DESIGN.md` *(not yet written)* — when drafted, must select and justify a scalable localization storage strategy against this ADR's requirement 10, not against a two-language assumption.
- `API_STANDARDS.md` *(not yet written)* — when drafted, must state that language is negotiated at the presentation boundary (e.g. header-based locale negotiation) and never encoded into domain/business logic.
- Every future feature specification (`PRODUCT_REQUIREMENTS.md` and any capability doc) must include a localization acceptance criteria section from this point forward.

This ADR is written now, ahead of the documents it binds, deliberately — the same pattern established by `ADR-0002` preceding `SYSTEM_ARCHITECTURE.md`. A principle constrains the document; the document is not written first and reconciled after.

---

## Related Documents
- `PROJECT_MANIFEST.md` — updated this turn to reference this ADR
- `ADR-0002-modular-monolith.md` — this principle applies within every module
- `BARQ_BIBLE.md`, `ARCHITECTURE_PRINCIPLES.md`, `DESIGN_SYSTEM.md`, `AI_STRATEGY.md`, `DATABASE_DESIGN.md`, `API_STANDARDS.md` — not yet written; each is obligated to cite this ADR when drafted

## Open Questions
1. Translation storage strategy (translation table vs. locale-suffixed columns vs. JSON locale map) is intentionally left open here — to be resolved in `DATABASE_DESIGN.md`, constrained by requirement 10 above.
2. **Resolved by `LOCALIZATION.md` §3:** locale negotiation follows a stored user preference, then request-level negotiation, then Arabic default — no longer open. `LOCALIZATION.md` is the authoritative source for this decision.

## Future ADR References
- **`ADR-0010-multilingual-architecture-expansion.md`** — supersedes this ADR's two-language scope, expanding the officially targeted language set to eight (Arabic, English, German, Italian, Polish, French, Czech, Russian) while reaffirming every principle recorded here.
- Any further change to the bilingual/multilingual-by-design principle itself, or any exception granted to a specific feature, requires a superseding ADR — it cannot be quietly narrowed in a feature spec.
