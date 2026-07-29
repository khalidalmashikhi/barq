# Execution Contract (EC-001)

**Status:** Approved, Locked. **Effective:** 2026-07-23, immediately following `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md`.

This document is the permanent implementation contract for all BARQ development from this point forward. It governs *how* every future phase is proposed, implemented, verified, and reported — it does not itself decide *what* gets built (that is `docs/plans/ROADMAP.md`, frozen by `ADR-0012`) or *why* (that is the ADR record under `docs/08-governance/adr/`). Every future implementation phase — by any AI agent or human contributor — follows this contract without exception. A phase that skips a section below is not complete, regardless of how the code itself looks.

## 1. Implementation Principles

1. **BARQ First.** Never implement hypothetical SaaS features. If BARQ needs it now, build it. If BARQ may need it in two years, document it — do not implement it. (`ADR-0012`)
2. **Small atomic phases only.** A phase is scoped to be independently reviewable and revertible.
3. **One engine at a time.** Never implement multiple engines together, even if related.
4. **No architecture redesign without approval.** A phase implements previously-approved architecture; it does not silently reshape it.
5. **No breaking changes.** Existing routes, models, APIs, tests, and behavior are preserved unless a phase explicitly, approvedly requires otherwise.
6. **Preserve all ADRs.** No Locked ADR is edited, reinterpreted, or bypassed by an implementation phase — only a new ADR supersedes one.
7. **Preserve API-first architecture.** Every new capability follows `ADR-0011` — versioned, shared business logic, platform-independent.
8. **Every implementation must be production quality.** No placeholder logic, no TODO-and-ship, no silently-degraded error handling.
9. **Every implementation must include tests.** No phase ships without test coverage for its own new logic.
10. **Every implementation must update documentation.** Code and docs land together, never docs-later.

## 2. Required shape of every future phase

### Before implementation, provide:
- **Objective** — what this phase does and why, in scope-bounded terms.
- **Files affected** — the concrete file list, new and modified.
- **Risks** — what could go wrong, including non-obvious ones (race conditions, migration order, auth bypass surface).
- **Migration impact** — schema changes, backfills, data migration ordering, reversibility.
- **Rollback strategy** — how to undo this phase if it needs to be reverted after merge.

Implementation does not begin until this is presented and explicitly approved.

### After implementation, provide:
- **What changed** — a plain description of the real diff, not a restatement of the objective.
- **Tests executed** — what ran, what passed, what (if anything) was skipped and why.
- **Remaining risks** — anything not fully closed by this phase, named plainly rather than omitted.
- **Documentation updated** — which files, and what changed in each.
- **`git diff --stat`**
- **`git diff --name-only`**

## 3. Quality gates

A phase is **not complete** unless all of the following hold:

- ✓ Tests pass
- ✓ Lint passes
- ✓ Types pass
- ✓ Documentation updated
- ✓ No known regression
- ✓ No duplicated logic
- ✓ No unnecessary abstraction

Any gate that cannot be satisfied is surfaced explicitly before the phase is reported as done — never silently waived.

## 4. Implementation order

Strictly follow the frozen roadmap in `docs/plans/ROADMAP.md` (Phase 0 through Phase 9, per `ADR-0012`). Never jump ahead to a later phase. Never implement multiple engines together, even when they seem related or a shortcut is tempting.

## 5. Stop condition

After every completed phase: **stop.** Wait for explicit approval before starting the next phase. Never continue automatically from one phase into the next, regardless of how routine the next phase appears.

## Related Documents

- `ADR-0012-architecture-freeze-v2-saas-scope-deferral.md` — the architectural boundary this contract implements against.
- `docs/plans/ROADMAP.md` — the frozen phase order this contract's §4 enforces.
- `docs/plans/IMPLEMENTATION-PLAN.md` — where each phase's own before/after reporting (per §2) is expected to accumulate.
- `CLAUDE.md`, `AGENTS.md` — reference this contract as a standing rule for all future work.
- `docs/project-memory/16-BUSINESS-RULES.md`, `docs/project-memory/17-CHANGELOG-DECISIONS.md` — where phase-level decisions and rule changes continue to be recorded as they happen.
