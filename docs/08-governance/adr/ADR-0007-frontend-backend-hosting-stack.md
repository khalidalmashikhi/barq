# ADR-0007: Frontend, Backend, and Hosting Stack (Next.js, TypeScript, Node.js, Vercel)

- **Purpose:** Formally record BARQ's Frontend, Backend, and Hosting technology decisions — the two remaining High Reversal Cost gaps `SYSTEM_ARCHITECTURE.md` §9 left open after `ADR-0006` closed the Database gap.
- **Scope:** Frontend framework, backend framework/runtime, and primary hosting platform, at the specific-technology level.
- **Out of Scope:** The full technology stack built on top of these choices (owned by `TECH_STACK.md`), any implementation, configuration, or installation detail.
- **Dependencies:** `SYSTEM_ARCHITECTURE.md` §9 (which flagged all three as High Reversal Cost, requiring dedicated ADRs before implementation), `ADR-0002-modular-monolith.md`, `ADR-0006-database-baseline.md` (Prisma's TypeScript orientation is a direct input to this decision), `ARCHITECTURE_PRINCIPLES.md` Principle 9 (Mobile First), Principle 26 (Cost-Aware Architecture), `ADR-0005-bilingual-architecture.md`.
- **Status:** Approved v1.0 — Locked upon acceptance.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## Context

`SYSTEM_ARCHITECTURE.md` §9 stated Frontend, Backend, and Hosting at the category level only, explicitly flagging all three as High Reversal Cost and requiring dedicated ADRs naming specific technology before implementation begins. This ADR fulfills that obligation for all three simultaneously, since they form one coherent, mutually-reinforcing stack decision rather than three independent choices.

## Decision

- **Frontend:** Next.js (React, TypeScript). Satisfies §9's original rationale — a component-based framework with strong ecosystem support for the highly interactive Operations Center and live-tracking views, plus mature RTL/i18n tooling compatible with `ADR-0005`.
- **Backend:** Next.js Route Handlers and Server Actions, running on Node.js LTS, in TypeScript. Satisfies §9's original rationale for a single dominant runtime with strong async I/O support (relevant to Notifications and Tracking) — and specifically resolves §9's Open Question about Backend/ORM alignment, since a TypeScript backend pairs directly with Prisma (`ADR-0006`) without a language boundary between data access and business logic.
- **Hosting:** Vercel for both development and initial production hosting. Satisfies §9's original rationale for managed, low-operational-overhead hosting that matches the Modular Monolith's single-deployable shape (`ADR-0002`) and minimizes premature infrastructure cost (`ARCHITECTURE_PRINCIPLES.md` Principle 26) — Vercel's native fit for Next.js specifically reduces integration risk between the Frontend/Backend choice and the Hosting choice, since both come from the same ecosystem rather than requiring separate reconciliation.

Together, Next.js + TypeScript + Node.js + Vercel form one integrated decision: choosing Next.js without also choosing a Next.js-native hosting platform would reintroduce exactly the kind of avoidable integration cost Cost-Aware Architecture (Principle 26) exists to prevent.

## Alternatives Considered

- **Separate frontend framework + separate backend language/runtime** (e.g. a dedicated SPA framework with a separate Python/Java backend): Rejected — reintroduces a language boundary between frontend and backend that a unified TypeScript stack avoids, and multiplies the operational surface area for a team at BARQ's current stage, contradicting Cost-Aware Architecture.
- **Self-managed virtual machines or a self-managed Kubernetes cluster for hosting:** Rejected — meaningfully more operational burden than BARQ's stage justifies; the same reasoning `SYSTEM_ARCHITECTURE.md` §9 already gave for preferring managed hosting over self-managed infrastructure.
- **A different meta-framework or a non-framework SPA setup:** Rejected — Next.js's combined frontend/backend capability (Route Handlers, Server Actions) directly serves the Modular Monolith's single-deployable philosophy; a plain SPA would require a fully separate backend service to be chosen and integrated regardless.

## Consequences

- **Positive:** Closes the last two of `SYSTEM_ARCHITECTURE.md` §9's three High Reversal Cost gaps (alongside `ADR-0006`'s Database), giving the project a complete, internally consistent core stack before any implementation begins. TypeScript end-to-end (frontend, backend, and Prisma) reduces context-switching cost and a class of type-mismatch defects at the frontend/backend boundary.
- **Negative / Cost:** Vercel-native hosting creates a degree of platform affinity; migrating off Vercel later, while possible (Next.js is not exclusively tied to Vercel), is not zero-cost. This is accepted explicitly, not overlooked — it is the reasoned trade-off Cost-Aware Architecture calls for at this stage, not a permanent constraint (§14/§22 of `TECH_STACK.md` name Docker/Kubernetes/multi-region as future evolution paths precisely because this trade-off is understood as a current-stage choice, not a forever one).
- **Follow-up Required:** `TECH_STACK.md` builds the full technology stack on top of this decision. Authentication technology (Better Auth vs. NextAuth) remains explicitly a *proposed*, not Locked, choice pending future `AUTHENTICATION.md` — this ADR does not extend to that decision.

---

## Related Documents
- `SYSTEM_ARCHITECTURE.md` — §9, the document this ADR closes the remaining gaps in
- `TECH_STACK.md` — the full technology stack built on top of this ADR's decisions
- `ADR-0002-modular-monolith.md`, `ADR-0006-database-baseline.md` — the architectural decisions this ADR is directly consistent with and builds on
- `ADR-0005-bilingual-architecture.md` — constrains the Frontend choice's RTL/i18n requirement

## Open Questions
- None at this time — this ADR resolves the Frontend/Backend/Hosting decision it was raised to make.

## Future ADR References
- Any future change to Frontend framework, Backend framework/runtime, or primary Hosting platform requires an ADR that explicitly supersedes this one.
- A future decision to migrate off Vercel (e.g. to self-managed infrastructure, per the Negative/Cost note above) requires its own ADR, not a routine infrastructure change.
