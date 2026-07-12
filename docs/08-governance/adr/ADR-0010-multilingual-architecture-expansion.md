# ADR-0010: Multilingual Architecture Expansion (8 Officially Targeted Interface Languages)

- **Purpose:** Record the decision that BARQ's target interface language set expands from the two languages fixed by `ADR-0005` (Arabic + English) to eight, and that the localization architecture must be designed against an N-language target from this point forward, not a two-language assumption. This ADR supersedes `ADR-0005`'s scope on language count only — it does not reopen or weaken any of `ADR-0005`'s architectural principles (bilingual-by-design, RTL-as-first-class, no hardcoded strings, language-neutral domain/API layer), which remain fully binding and are reaffirmed, not replaced.
- **Scope:** The official target language list, Arabic's continued status as the primary/default RTL language, English's status as the confirmed secondary language, the six additional first-wave international languages, and the binding requirement that the architecture support adding any of these (and future languages beyond them) without structural code changes. Also records that the current `src/lib/i18n/strings.ts` implementation is confirmed transitional, not a prior decision being newly reversed — it was already documented as a stopgap when written (Engineering Sprint 3), and this ADR does not change that classification, only makes the obligation to eventually replace it explicit and binding.
- **Out of Scope:** The actual i18n library/framework selection, the translation-key file structure, the specific database multilingual-content storage mechanism beyond what `ADR-0005` requirement 7 and `PRISMA_SCHEMA.md` already establish (the `Json` locale-map pattern), and any code migration. No migration is implemented by this ADR — per explicit instruction, this is a documentation-only decision record. The migration plan itself is future work requiring its own Architecture Change classification and approval, per `ENGINEERING_GUIDE.md`/the project's engineering workflow.
- **Dependencies:** `ADR-0005-bilingual-architecture.md` (this ADR supersedes its language-count scope only, per `PROJECT_RULES.md` §4 — a Locked ADR is never edited in place, only superseded by a later one), `PROJECT_MANIFEST.md` Core Value 4 and Design Philosophy §8 (Arabic-first remains the identity commitment; this ADR does not change Arabic's primary status, it adds languages alongside it), `DATABASE_DESIGN.md` §20 and `PRISMA_SCHEMA.md` (existing `Json` locale-map multilingual content strategy, which this ADR requires be extended in scope, not replaced in mechanism), `LOCALIZATION.md` §3 (locale negotiation priority — stored preference → request-level negotiation → Arabic default — unaffected by this ADR).
- **Status:** Approved v1.0 — Locked upon acceptance.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## Context

`ADR-0005` fixed Arabic and English as BARQ's two co-equal, architecturally-binding languages, correctly warning against localization being "a feature layered onto a finished product." That principle has held: the current implementation (`src/lib/i18n/strings.ts`) already carries English values alongside every Arabic string, and multilingual database content (`Service.name`, `Provider.businessName`, etc.) already uses a `Json` locale-map (`{ "ar": "...", "en": "..." }`) specifically because `ADR-0005` requirement 9 demanded a mechanism that could extend to future languages without a schema change.

BARQ's actual market ambition — Oman first, then the wider GCC, with an explicit long-term vision of a GCC-wide and eventually broader operations layer (`PROJECT_MANIFEST.md` §2, §13) — was never going to stop at two languages. The two-language scope in `ADR-0005` was correct for what was decided *at that time*, not a ceiling on the product's actual direction. This ADR is the formal, deliberate decision to state the real target now — eight interface languages — so that every future feature is built against the true destination rather than repeatedly discovering, feature by feature, that "just Arabic and English" was never the real requirement.

This decision was reached through direct instruction from the BARQ core team (via this project's engineering conversation, 2026-07-11), first recorded as a set of permanent engineering/architecture rules, then explicitly elevated by the same authority to formal ADR status superseding `ADR-0005`'s language-count scope. No implementation has occurred — this ADR exists specifically to make the decision and its binding requirements explicit ahead of any migration, per this project's own standing practice of writing the ADR before the affected documents/code, not after (`ADR-0002` before `SYSTEM_ARCHITECTURE.md`; `ADR-0005` before the documents it binds; this ADR follows the identical pattern).

## Decision

BARQ officially targets **eight interface languages**. The following are binding architectural requirements, reaffirming `ADR-0005`'s principles at N-language scope rather than replacing them:

1. **Arabic (`ar`) remains the primary language and default RTL language** — unchanged from `ADR-0005`. Nothing in this ADR demotes Arabic's status; it remains the default at launch and the language every other requirement is measured against for parity.
2. **English (`en`) is the confirmed secondary language**, with the same full-parity obligation `ADR-0005` already established — still first-class, still never a fallback for Arabic, still never allowed to be the language the architecture is implicitly built around.
3. **German (`de`), Italian (`it`), Polish (`pl`), French (`fr`), Czech (`cs`), and Russian (`ru`) are planned first-wave international languages** — officially targeted, not yet required to ship as complete translations (see Requirement 8).
4. **The architecture must support adding any future language — including these six and any beyond them — without structural code changes.** Adding a language is a content/configuration operation (new translation-key values, a new locale-map entry), never an application code change, never a schema migration, never a change to component logic. This restates and extends `ADR-0005` requirement 9 from a 2-language to an N-language guarantee.
5. **Translation infrastructure must remain scalable** to this full target set. Whatever mechanism eventually replaces the current `strings.ts` stopgap (a decision explicitly out of this ADR's scope, to be made via its own Architecture Change proposal) must be evaluated against supporting 8 languages cleanly — not selected as if only 2 languages would ever exist, and not selected in a way that would need re-architecture to grow from 2 to 8.
6. **The existing Arabic/English implementation is confirmed transitional, not final.** `strings.ts`'s own header comment already disclosed this when it was written ("a deliberately minimal stopgap, not a new architectural decision... do not treat this file as the final i18n architecture") — this ADR makes that disclosure a binding fact rather than a self-aware caveat that could be quietly forgotten as more features accumulate on top of it.
7. **No hardcoded user-facing text, anywhere** — restated from `ADR-0005` requirement 5, now explicitly scoped against an 8-language target rather than a 2-language one. This includes components, pages, Server Actions, and API responses alike.
8. **New features are not required to ship all 8 languages immediately.** Until a dedicated translation phase is explicitly initiated, new features must at minimum: define real translation keys (never inline literals), and provide Arabic + English values for those keys. This keeps every feature compliant with Requirement 4 (structural readiness) without imposing translation work for six languages on every unrelated feature — a deliberate, bounded scope decision, not a loophole.
9. **No silent fallback to hardcoded Arabic or English text.** A missing translation key or locale value must surface as a visible, honest gap (e.g. a clearly-flagged missing-translation state), never a silent substitution that masks incomplete localization work.
10. **Locale-aware behavior extends beyond strings**: dates, numbers, currencies, pluralization rules, validation messages, and status labels must all be locale-aware under this architecture, not treated as static-string concerns only. Pluralization in particular becomes materially more complex once Slavic languages (Polish, Czech, Russian) are in scope — each has multiple plural forms unlike Arabic/English's simpler two-form pattern — and any future translation-infrastructure decision must account for this rather than assume English-style singular/plural is sufficient.
11. **Database-persisted translated content continues to use BARQ's already-approved multilingual content structure** (the `Json` locale-map pattern established under `ADR-0005`/`PRISMA_SCHEMA.md`) — this ADR extends that pattern's expected key space (e.g. `{ "ar": "...", "en": "...", "de": "...", ... }`), it does not introduce a second, competing mechanism.
12. **RTL and LTR layouts must both work correctly** at the full target-language scope — restated from `ADR-0005` requirement 3. Of the eight target languages, Arabic is RTL; English, German, Italian, Polish, French, Czech, and Russian are LTR. This does not change the RTL/LTR binary itself, only confirms it must hold correctly across every language ultimately added.

**Explicitly not decided by this ADR:**
- The specific i18n library/framework replacing `strings.ts` (`TECH_STACK.md`'s own "Future Evaluation" status for tools like this is unaffected).
- The specific translation-key file structure or storage format.
- Any timeline for when German/Italian/Polish/French/Czech/Russian move from "planned" to "required complete translation."
- Any change to `LOCALIZATION.md` §3's resolved locale-negotiation priority (stored preference → request-level negotiation → Arabic default), which is unaffected by adding more languages to the target set.

**Process requirement, binding on all future work:** before any change to the current i18n architecture itself (library adoption, `strings.ts` restructuring, locale-map key-space migration in the database), that change must be classified as an **Architecture Change**, accompanied by a migration plan, and explicitly approved before implementation begins — consistent with this project's standing engineering-workflow discipline (`PROJECT_RULES.md` §1, §4, §9) and now recorded here as a specific, binding instance of it.

## Consequences

**Positive**
- Removes the risk of building six more languages' worth of retrofit work later by ensuring every new feature, from now on, is built against the real 8-language target rather than a 2-language assumption that would eventually need to be unwound.
- Gives a concrete, testable answer to "is this hardcoded string OK for now" — it is only ever acceptable as a translation key with `ar`+`en` values, never as inline text, regardless of whether the other six languages exist yet.
- Confirms the existing `Json` locale-map database pattern was the right call under `ADR-0005` and remains the right call at 8-language scope — no wasted prior work, no forced schema rework triggered by this ADR alone.
- Provides a clear, deliberate boundary (Requirement 8) preventing this ADR from being misread as "every feature must now ship 8 complete translations," which would otherwise stall unrelated feature work indefinitely.

**Negative / Cost**
- Whatever i18n library is eventually selected must be evaluated more rigorously than a 2-language stopgap required — in particular for Slavic-language pluralization (Polish, Czech, Russian each have multiple plural forms), which `strings.ts`'s flat key/value shape cannot express and which no decision has yet been made to solve.
- The eventual migration off `strings.ts` is now a confirmed, larger piece of future work than "swap two objects for a library call" — it must be designed for 8 languages' key space and locale-aware formatting (dates/numbers/currency/pluralization) from the start, per Requirement 10.
- Every future feature now carries an explicit, permanent obligation (Requirement 8) to define translation keys with `ar`+`en` values at minimum — a small but real discipline cost on every feature, not just localization-focused ones.

**Follow-up Required — binding on future documents, not completed by this ADR itself:**
- `LOCALIZATION.md` — should be updated to reflect the 8-language target list and cite this ADR; not yet done as part of this change (documentation-only scope, per explicit instruction to create only this ADR).
- `BARQ_BIBLE.md`'s ADR Index — should list ADR-0010 once the index is next updated; not edited by this ADR's own creation, per the same minimal-scope instruction.
- `PROJECT_MANIFEST.md` §8 — currently cites `ADR-0005` for bilingual-by-design; may warrant a cross-reference update to acknowledge the expanded target, at the Manifest owner's discretion — not decided or performed here.
- `TECH_STACK.md` — the i18n library "Open Decision" it already carries should eventually be resolved against this ADR's 8-language and pluralization requirements specifically, not decided independently of them.
- A future, separately-approved migration plan (Architecture Change) is required before any code change to the current i18n implementation.

---

## Related Documents
- `ADR-0005-bilingual-architecture.md` — superseded on language-count scope only by this ADR; its principles (bilingual-by-design mechanics, RTL-as-first-class, no-hardcoded-text, language-neutral domain/API layer) remain fully in force and are reaffirmed above, not replaced
- `PROJECT_MANIFEST.md` — Core Value 4, Design Philosophy §8 — Arabic-first identity commitment, unchanged by this ADR
- `PRISMA_SCHEMA.md`, `DATABASE_DESIGN.md` §20 — existing `Json` locale-map multilingual content strategy, extended in key-space scope, not mechanism, by this ADR
- `LOCALIZATION.md` — owns locale-negotiation priority (unaffected) and should be updated to reflect the 8-language target (follow-up, not yet done)
- `TECH_STACK.md` — owns the still-open i18n library/tooling decision, now scoped against this ADR's requirements
- `src/lib/i18n/strings.ts` — the current transitional implementation this ADR confirms must eventually be replaced, without prescribing when or with what

## Open Questions
1. Timeline/sequencing for when each of German, Italian, Polish, French, Czech, and Russian moves from "planned first-wave" to an actively-worked translation effort — not decided here, a product/business-prioritization question deferred to `ROADMAP.md`/`BUSINESS_MODEL.md`.
2. Whether additional languages beyond these eight are ever anticipated, and if so whether the "GCC then broader" framing in `PROJECT_MANIFEST.md` §13 implies specific further languages (e.g. other GCC-relevant languages) — not raised or decided here, flagged for whoever next revisits the language target list.
3. The specific i18n library, translation-key file format, and pluralization-handling mechanism remain fully open, deferred to a future `TECH_STACK.md` resolution and a subsequent Architecture Change proposal for the actual migration.

## Future ADR References
- Any change to the 8-language target list itself (adding, removing, or reordering priority among the six first-wave languages) requires a superseding ADR, consistent with how this ADR itself superseded `ADR-0005`'s language-count scope.
- The eventual i18n architecture migration (library adoption, `strings.ts` replacement, locale-map key-space expansion in the database) does not itself require a new ADR unless it changes a principle stated here — but per this ADR's own Process Requirement above, it does require Architecture Change classification, a migration plan, and explicit approval before implementation.
