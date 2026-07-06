# BARQ Engineering Guide

- **Purpose:** Define how BARQ is engineered day to day — the daily engineering handbook governing human developers and AI coding agents equally. Covers engineering workflow, coding workflow, review workflow, documentation workflow, branching strategy, quality expectations, and release discipline.
- **Scope:** Engineering values, the practical engineering workflow, Git workflow, AI-assisted development governance, code review, testing philosophy, documentation workflow, coding standards (by reference), performance expectations, release process, incident workflow, and technical debt management.
- **Out of Scope:** Architecture (`ARCHITECTURE_PRINCIPLES.md`, `SYSTEM_ARCHITECTURE.md`), ADRs, coding standards already documented elsewhere (`PROJECT_RULES.md` §23, `DATABASE_DESIGN.md` §17), API design (`API_CONTRACTS.md`), security architecture (`SECURITY.md`), design system (`DESIGN_SYSTEM.md`). This document operationalizes those into daily practice; it does not redefine any of them.
- **Dependencies:** `PROJECT_MANIFEST.md` (Engineering Philosophy §6, Decision Framework §12), `PROJECT_RULES.md` (§1–§25 in full — this document is that document's daily-practice companion, not a replacement for any of its rules), `ARCHITECTURE_PRINCIPLES.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_CONTRACTS.md`, `TECH_STACK.md`, `SECURITY.md`, `DEPLOYMENT_AND_INFRASTRUCTURE.md`, `DESIGN_SYSTEM.md`, `LOCALIZATION.md`, `ACCESSIBILITY.md`, `AUTHENTICATION.md`, `IDENTITY_AND_ACCESS.md`, `AI_STRATEGY.md`, `AI_AGENTS.md`.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## A Note on This Document's Relationship to PROJECT_RULES.md

`PROJECT_RULES.md` is the constitutional-level process document — it establishes *that* certain rules exist (Documentation First, the ADR process, Definition of Done, Git branch protection, and so on) and why. This document is the operational handbook an engineer — human or AI — actually opens day to day: it restates those rules in practical, workflow-shaped form and adds the daily mechanics `PROJECT_RULES.md` didn't need to specify at its own level of abstraction. Where the two could be read as disagreeing, `PROJECT_RULES.md` governs; this document exists to make following it easier, never to quietly loosen it.

---

## 1. Executive Summary

BARQ engineering follows one non-negotiable sequence, stated in `PROJECT_MANIFEST.md` Engineering Philosophy §6 and enforced throughout this project's own history: Documentation → Design → Architecture → Implementation → Testing → Documentation Update. This document is where that sequence becomes a daily practice for whoever is actually writing code — human or AI. Per `PROJECT_MANIFEST.md`'s Decision Framework §12, when a deadline conflicts with quality, architecture, or documentation discipline, the deadline moves, not the standard. Every one of `ARCHITECTURE_PRINCIPLES.md`'s 26 principles has a corresponding daily practice below; this guide is where they stop being architecture-review checklist items and become the thing an engineer does automatically, every day, without having to re-derive it from first principles each time.

## 2. Engineering Values

- **Quality over Speed:** Per `PROJECT_MANIFEST.md` §12 — restated as the value every other item on this list serves.
- **Documentation First:** Per `PROJECT_RULES.md` §1 — no implementation work begins without an approved document behind it.
- **Small Iterations:** Progressive Documentation (`ARCHITECTURE_PRINCIPLES.md` Principle 3) applies to code the same way it applies to documents — a small, reviewable change is preferred over a large one that's hard to reason about or roll back.
- **Review Culture:** Per `PROJECT_RULES.md` §14 — no self-approval, ever, for any change, human- or AI-authored.
- **Automation:** Per `DEPLOYMENT_AND_INFRASTRUCTURE.md` §2's Automation First — manual production operations are the exception requiring justification, not the default.
- **Simplicity:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 17 — the simpler, more obvious solution is chosen over a cleverer one, even under time pressure.
- **Long-Term Maintainability:** Per Principles 2, 5, 18–19 — every change is evaluated by whether the next engineer (human or AI) can understand and safely modify it, not only by whether it works today.

## 3. Engineering Workflow

The practical, daily-use form of `PROJECT_RULES.md` §9's Feature Lifecycle:

```
Idea
  ↓
Documentation (approved spec exists, per §1 Documentation First)
  ↓
Architecture (fits Modular Monolith + DDD structure, checked per §6 below)
  ↓
ADR (if required — per PROJECT_RULES.md §4, only for decisions expensive to reverse)
  ↓
Implementation
  ↓
Testing (per §7 below)
  ↓
Documentation Update (spec corrected to match reality if implementation revealed a gap — the single most important step in this whole sequence, per PROJECT_RULES.md §9)
  ↓
Merge (per §4 below)
  ↓
Release (per §11 below)
```

No step is skipped for convenience. An "ADR (if required)" step that turns out to be required but was skipped is treated as a process defect, caught at Code Review (§6), not a minor oversight to wave through.

## 4. Git Workflow

Fully governed by `PROJECT_RULES.md` §11–§13 — referenced, not redefined. One operational note specific to this document's purpose: `PROJECT_RULES.md` §11.2's temporary documentation-phase exception (direct commits to `main` permitted for documentation only) **closes automatically and permanently the moment application code implementation begins.** This document's own existence is a strong signal that BARQ is approaching that transition, but creating an engineering guide is not itself the triggering event — the first real application code commit is. Whoever makes that first commit should ensure the closure is explicitly noted in `DEVELOPMENT_LOG.md`, per `PROJECT_RULES.md` §11.2's own instruction, rather than letting the exception lapse unremarked.

- **Main:** Protected, always deployable, per `PROJECT_RULES.md` §11.1.
- **Feature Branches:** Named per `PROJECT_RULES.md` §12's convention, matching the Bounded Context they touch.
- **Pull Requests:** The only path to `main` once §11.2's exception closes — no exception for urgency (§14).
- **Commit Convention:** Conventional Commits, per `PROJECT_RULES.md` §13.
- **Merge Strategy:** Specific merge mechanics (squash vs. merge commit) are an Open Decision (§15), not fixed here.
- **Branch Protection:** Enforced via CI/CD (`TECH_STACK.md` §14) — required checks (tests, review approval) block merge automatically, never bypassed manually.

## 5. AI-Assisted Development

Coding assistants used on this project — **Hermes, Claude, Copilot, Cursor** — are governed identically, without exception, per `PROJECT_RULES.md` §20.1–§20.2. This section makes that governance concrete for code specifically, extending a discipline this project has so far applied consistently to AI-drafted *documentation* to AI-drafted *code* as implementation begins:

- **Human Review:** No AI-generated or AI-modified code is merged without full human code review (§6) — the same standard as human-authored code, never a lower bar because "an AI wrote it and it looks reasonable."
- **Approval:** AI-authored code is approved (or rejected, or sent back for revision) by exactly the same Code Review checklist (§6) as any other change — no separate, lighter-touch approval path for AI-authored contributions.
- **Logging:** Every AI-generated or AI-modified code change is recorded in `DEVELOPMENT_LOG.md` at the time it is made, per `PROJECT_RULES.md` §20.2 — this is the same logging discipline already used for every AI-drafted document throughout this project, now extended to code once implementation begins.

This section does not evaluate or recommend among Hermes, Claude, Copilot, and Cursor specifically — tool selection and comparison is an implementation-tooling decision, not an engineering-governance one, and each is held to the identical standard above regardless of which is used for a given contribution.

## 6. Code Review

- **Review Checklist:** Every PR is checked against the sub-reviews below before merge — not as separate, sequential approval gates, but as one reviewer's (or several reviewers') single pass covering all applicable dimensions for the change in question.
- **Architecture Review:** Does the change respect `SYSTEM_ARCHITECTURE.md`'s module boundaries and `DOMAIN_MODEL.md`'s Bounded Context ownership? A change that reaches across a module boundary without going through a governed interface (`ADR-0006`'s cross-module access rule) is rejected here, not fixed later.
- **Security Review:** Per `SECURITY.md` — required for any change touching Authentication, Wallet, Payments, or Identity/Access, at minimum; per `SECURITY.md` §5's data classification, any change touching Confidential or Restricted data gets this review regardless of which module it's in.
- **Performance Review:** Per `SYSTEM_ARCHITECTURE.md` §10 and `DEPLOYMENT_AND_INFRASTRUCTURE.md` §7 — required for any change touching a latency-sensitive path (Booking creation, Live Tracking, Notifications).
- **Accessibility Review:** Per `ACCESSIBILITY.md` — checked at PR time for any UI-facing change, not audited after the fact; a PR introducing a new interactive component without keyboard/screen-reader support fails this review, it does not merge with a promise to fix it later.
- **Localization Review:** Per `LOCALIZATION.md`/`ADR-0005` — checked at PR time for any UI- or content-facing change; a feature shipping in one language only fails this review outright, consistent with this project's absolute bilingual-parity requirement.
- **AI Review:** Per `ADR-0008` and `AI_AGENTS.md` — required for any change touching the AI Layer; verifies the change doesn't grant an AI Agent a capability its governing specification doesn't already document.

## 7. Testing Philosophy

- **Unit:** Per `TECH_STACK.md` §17 (Vitest) and `PROJECT_RULES.md` §15's binding minimum — risk-weighted, with Wallet, Booking, Pricing, and Authentication logic held to the highest coverage bar.
- **Integration:** Verifies cross-module interaction through governed interfaces (§6's Architecture Review companion at the testing level) — confirming modules integrate correctly, not just that each works in isolation.
- **E2E:** Per `TECH_STACK.md` §17 (Playwright) — including bilingual/RTL-LTR verification as a standard part of E2E coverage, not a separate, optional test suite.
- **Regression:** Every fixed bug (§12) gets a regression test preventing its recurrence — a bug fixed without one is considered incompletely fixed.
- **Manual Testing:** Reserved for genuinely subjective UX/accessibility spot-checks that automation can't meaningfully cover — a complement to automated testing, never a substitute for it where automation is possible.
- **Acceptance:** Tied to `PRODUCT_REQUIREMENTS.md` §15's V1 Acceptance Criteria and each feature's own Definition of Done (`PROJECT_RULES.md` §8) — a feature isn't Done because it passed unit tests; it's Done when it meets its full Definition of Done.

## 8. Documentation Workflow

- **Update Documentation Before Implementation:** Per `PROJECT_RULES.md` §1 — the default, expected order.
- **Update Documentation After Implementation:** Per `PROJECT_RULES.md` §9 — if implementation reveals the original spec was incomplete or wrong, the spec is corrected before implementation continues, not left to silently diverge from what was actually built.
- **Cross-Reference Updates:** Where a change affects another document's stated dependency on the one being changed, that cross-reference update is a deliberate, explicit action — flagged in the PR description if not performed in the same change — consistent with the process discipline this project has followed in its own documentation history (flag-then-confirm, rather than silent side-effect edits to other Locked documents).
- **SSOT Enforcement:** Checked as part of Architecture Review (§6) — a PR that duplicates a rule or fact already owned by another document is sent back to reference it instead, not merged with the duplication intact.

## 9. Coding Standards

This document does not redefine coding standards — it points to where they live:

- **Naming:** Per `PROJECT_RULES.md` §23 — English-only identifiers, matching `GLOSSARY.md` terms exactly for every domain concept.
- **Files / Modules:** Organized to mirror `SYSTEM_ARCHITECTURE.md` §5's module structure — a file's location should make its owning Bounded Context obvious, not require tracing imports to discover it.
- **Comments:** Explain *why*, not *what* — code should be self-explanatory for what it does (per Simplicity, §2); comments earn their place by adding context a reader couldn't get from the code itself.
- **Formatting:** Specific formatter/linter tooling and configuration is an Open Decision (§15) — not fixed in this document.
- **Consistency:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 19 — the established pattern is followed, not reinvented per file or per engineer.

## 10. Performance Expectations

- **Performance Budget:** Specific numeric budgets are not yet fixed anywhere in this project's documentation (`PRODUCT_REQUIREMENTS.md` §8 stated the *requirement* without numbers) — flagged again here as a real gap, not invented in this document either (§15).
- **Scalability:** Checked as part of Architecture Review (§6) — per `ARCHITECTURE_PRINCIPLES.md` Principle 21.
- **Caching Philosophy:** Per `SYSTEM_ARCHITECTURE.md` §6 and `DATABASE_DESIGN.md` §12 — never applied to live-correctness-required data (Wallet balance, Availability state), restated here because it is exactly the kind of rule easy to violate under review-time pressure to "just make it fast."
- **Lazy Loading:** Per `DESIGN_SYSTEM.md` §9 — applied by default for non-critical content, consistent with Mobile First.
- **Optimization:** Applied when measured need justifies it, never speculatively — premature optimization is a Simplicity (§2) violation as much as a performance-process one.

## 11. Release Process

Fully governed by `DEPLOYMENT_AND_INFRASTRUCTURE.md` §3–§4 — referenced, not redefined:

- **Development → Testing → Staging → Production:** The fixed promotion flow (`DEPLOYMENT_AND_INFRASTRUCTURE.md` §3).
- **Rollback:** Per that document's §4 — a defined path back to the previous known-good state, always available before a release ships.
- **Post-Release Review:** A brief retrospective after each release — did it ship what was documented, did any Documentation Update (§8) step get missed, did anything surface that belongs in Technical Debt (§13) — feeding this guide's own future revision the same way `SECURITY.md` §11's Lessons Learned feeds security practice.

## 12. Incident Workflow

- **Bug:** Tracked, fixed, regression-tested (§7) — a bug fix without a regression test is not considered complete.
- **Hotfix:** Whether an expedited path around the normal Staging gate exists for genuine emergencies is not decided in this document — it is the same open question already flagged in `DEPLOYMENT_AND_INFRASTRUCTURE.md` §15's Open Decision #6, not independently re-decided here.
- **Security Incident:** Fully governed by `SECURITY.md` §11 — referenced, not redefined.
- **Rollback:** Per `DEPLOYMENT_AND_INFRASTRUCTURE.md` §4.
- **Root Cause Analysis:** A structured analysis for any incident beyond a routine bug — feeding Lessons Learned, below.
- **Lessons Learned:** Recorded in `DEVELOPMENT_LOG.md` and, where the lesson changes a standing practice, reflected in a future revision of this guide or the relevant governing document — an incident that teaches nothing that changes future practice hasn't actually been learned from.

## 13. Technical Debt

- **Recording:** Every deliberate shortcut is recorded explicitly — which standard or principle was knowingly deviated from, and why — never a silent shortcut discovered later by someone else.
- **Prioritization:** Technical debt is reviewed and prioritized alongside feature work, not perpetually deferred to an unscheduled "someday."
- **Review:** Cadence is an Open Decision (§15) — not fixed here.
- **Removal:** Debt recorded per the above is actually paid down on some defined cadence, not merely tracked indefinitely as a list that only grows.

## 14. Anti-Patterns

Explicitly forbidden, without exception:

- Never bypass documentation — per §8 and `PROJECT_RULES.md` §1; no implementation without an approved spec behind it.
- Never bypass review — per §6 and `PROJECT_RULES.md` §14; no self-approval, ever.
- Never bypass ADR — per §3; a decision that needed one and didn't get one is a process defect caught at review, not waved through.
- Never push directly to main — per §4 and `PROJECT_RULES.md` §11.1, absolute once §11.2's exception closes.
- Never skip testing — per §7; every risk-weighted minimum in `PROJECT_RULES.md` §15 is a floor, not a target to negotiate down under deadline pressure.
- Never merge broken builds — CI/CD (§4, `TECH_STACK.md` §14) blocks this automatically; a manual override of that block is itself an anti-pattern, not a valid escape hatch.

## 15. Open Decisions

Intentionally deferred — not invented here:

1. **Specific performance budget numbers** (§10) — a real, standing gap across this project's documentation, not filled here either.
2. **Formatter/linter tooling and configuration** (§9) — deferred to implementation tooling choice.
3. **Merge strategy specifics** (squash vs. merge commit, §4) — not fixed.
4. **Hotfix/emergency deployment exception process** (§12) — shared open item with `DEPLOYMENT_AND_INFRASTRUCTURE.md` §15's Open Decision #6.
5. **Technical debt review cadence** (§13) — not yet defined.
6. **Code review SLA** (how quickly a PR must receive a review response) — not defined; a real operational gap once implementation begins in earnest.

---

## Related Documents
- `PROJECT_MANIFEST.md`, `PROJECT_RULES.md` — the philosophy and constitutional rules this document operationalizes into daily practice, in full
- `ARCHITECTURE_PRINCIPLES.md`, `SYSTEM_ARCHITECTURE.md`, `DOMAIN_MODEL.md` — governing §6's Architecture Review
- `SECURITY.md` — governing §6's Security Review and §12's Security Incident handling
- `ACCESSIBILITY.md`, `LOCALIZATION.md`, `ADR-0005` — governing §6's Accessibility and Localization Reviews
- `AI_STRATEGY.md`, `AI_AGENTS.md`, `ADR-0008` — governing §5 and §6's AI Review
- `TECH_STACK.md`, `DEPLOYMENT_AND_INFRASTRUCTURE.md` — governing §4, §7, §11
- `DATABASE_DESIGN.md` §17, `PROJECT_RULES.md` §23 — the naming/coding standards §9 references rather than redefines

## Open Questions
1. Should this document explicitly name which of Hermes, Claude, Copilot, or Cursor is preferred/default for which kind of task, or should tool selection remain entirely at the individual engineer's discretion within the uniform governance §5 already establishes? Flagged, not decided here — this is a tooling-preference question, not a governance one.
2. §4 flags that the first real application code commit is the trigger event closing `PROJECT_RULES.md` §11.2's exception — should that moment be declared formally in advance (a scheduled cutover) or simply recognized and logged whenever it naturally occurs? `PROJECT_RULES.md` §17's own Open Question #4 already raised this same question when that document was written; it remains unresolved here too, not re-decided independently.

## Future ADR References
- Any change to the Git Workflow's core mechanics (§4) beyond what `PROJECT_RULES.md` §11–§13 already fixes would need to be reconciled with that document first — this guide does not have independent authority to alter Git policy.
- Adoption of a specific formatter/linter, or a specific merge strategy (§15), does not require an ADR — these are exactly the kind of low/medium-risk, easily-reversible tooling choices the Technology Decision Matrix governance rule (established when `TECH_STACK.md` was Locked) exists to handle without one.
