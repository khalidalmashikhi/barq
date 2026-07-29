# Implementation Plan — Per-Phase Scoping

Placeholder structure only, now organized to match `ROADMAP.md`'s 9-phase recommended order. Each phase section stays empty (beyond its Status line) until separately scoped and explicitly approved — this file is not a committed schedule, and filling in a section is not authorization to start building it. The original 15-engine catalog (`../project-memory/03-PRODUCT-REQUIREMENTS.md`) is preserved in full — each phase below states exactly which catalog engine(s) it covers.

## Template for each phase, once approved

```
### Status: Not started | Scoping | Approved | In progress | Complete
### Approved scope
(what exactly was approved — list the concrete deliverables)
### Explicitly out of scope for this phase
(named exclusions, so nothing is silently expanded later)
### Affected files
(new files to create, existing files to extend — never delete/rebuild)
### Schema changes
(new models/fields/migrations, if any)
### Testing strategy
### Verification checklist
```

---

## Phase 1 — Core Business Platform
**Covers catalog engines:** #2 Dynamic Category Management, #10 Feature Flags, part of #9 CMS and Dynamic Homepage, plus the Visibility Engine and initial Business Rules concepts introduced in `ROADMAP.md`.
Status: Not started.

## Phase 2 — Provider Engine
**Covers catalog engines:** #11 Provider Onboarding and Approval (extended), part of #3 Form Builder (provider-facing forms).
Status: Not started.

## Phase 3 — Service Engine
**Covers catalog engines:** part of #7 Financial and Commission Engine (pricing-control-mode half), extends existing (already-real) Service management from Phase 4.2.
Status: Not started.

**Sub-scope: Relational Service Taxonomy & Marketplace Discovery** — replacing the temporary keyword-based category filter (shipped in the UX/Navigation Remediation, 2026-07-26) with a real `Service`↔`Category`/`SubCategory` relationship. Fully scoped in `docs/plans/RELATIONAL-SERVICE-TAXONOMY-PLAN.md` (4 proposed Stages) against `docs/08-governance/adr/ADR-0014-service-category-relational-taxonomy.md` (Draft). Status: **Drafted, not approved** — filling in this plan is not authorization for any Stage to begin.

## Phase 4 — Booking Engine
**Covers:** extension of the already-real, mature Booking lifecycle (Phases E.1, 4.1, 4.2, 5.1) — not a from-zero build.
Status: Not started (as an extension phase; the underlying engine is already substantially complete — see `../project-memory/01-CURRENT-STATE.md`).

## Phase 5 — Financial Engine
**Covers catalog engines:** #7 Financial and Commission Engine (discount/tax/net/settlement/transfer tracking, configurable commission models).
Status: Not started.

## Phase 6 — Communication Engine
**Covers catalog engines:** #6 Notification Engine (generalization), #12 Support / "ساعدني" Ticket Center, #13 Internal Messaging Center.
Status: Not started.

## Phase 7 — Translation Engine
**Covers catalog engines:** #8 Translation Management (AI-assisted workflow with review states, for provider-generated content).
Status: Not started.

## Phase 8 — AI Center
**Covers catalog engines:** #14 AI Center.
Status: Not started. Governed by ADR-0008's 17 permanent AI boundaries (BR-020) regardless of scoping details decided later.

## Phase 9 — Analytics & Reporting
**Covers:** not part of the original 15-engine catalog — newly introduced by the recommended 9-phase order. No product scoping exists yet.
Status: Not started — **needs product scoping before it can even reach "Scoping" status**, since its actual requirements (what's measured, for whom) are undefined. See `../project-memory/13-OPEN-QUESTIONS.md`.

---

## Cross-cutting: Audit Trail and Permission Engine (catalog #15)

Not its own phase — extends incrementally alongside whichever phase above is currently being built, per `ROADMAP.md`'s own note and BR-019. Current status: partially built (Phase 5.2 — `AuditLog` model + `record-audit-event.ts`, wired atomically into 6 mutation sites; `BookingStatusEvent`/`BookingContractEvent` predate it and remain the system of record for booking/contract status changes specifically). Remaining scope: a viewer UI, and extending write-coverage to every new mutation each future phase introduces.

## Cross-cutting: Business Engine and Rule Engine and Workflow Engine (catalog #1, #4, #5)

Not assigned to a single phase — per `ROADMAP.md`'s reasoning, these generalize from the concrete needs Phases 1–7 actually produce, rather than being built speculatively ahead of a second or third real use case (YAGNI, `docs/00-foundation/PROJECT_RULES.md`). Phase 1's "Business Rules" item is the first concrete instance this generalization would eventually draw from.

## Cross-cutting: Form Builder (catalog #3)

First applied narrowly in Phase 2 (provider-facing dynamic forms); whether it generalizes into a true admin-configurable Form Builder beyond that first application is a decision for after Phase 2 ships, not before.
