# ADR-0008: AI Agent Boundaries

- **Purpose:** Define the permanent architectural boundaries for every AI Agent in BARQ — what AI Agents are allowed to do, what they must never do, and when human approval is mandatory. This ADR is technology-independent: it defines governance only, not prompts, not models, not implementation.
- **Scope:** The 17 binding decisions below, applicable to every current and future AI Agent role, regardless of which LLM provider, framework, or capability implements it.
- **Out of Scope:** Prompts, model selection, LLM vendor detail, implementation of any kind. Full AI Agent role specifications (owned by the forthcoming `AI_AGENTS.md`, which this ADR precedes and binds).
- **Dependencies:** `PROJECT_MANIFEST.md` (AI Philosophy §7), `ARCHITECTURE_PRINCIPLES.md` (Principle 8, AI First; Principle 23, Human-in-the-Loop for High-Risk Actions), `AI_STRATEGY.md` (§2, §4 — this ADR formalizes and hardens that document's AI Boundaries into permanent, ADR-level governance), `DOMAIN_MODEL.md` (the `AI Agent` entity's stated invariant), `SYSTEM_ARCHITECTURE.md` (§4, §6, §12 — the AI Layer's architectural isolation this ADR's database/authorization rules enforce), `ADR-0002-modular-monolith.md`, `ADR-0006-database-baseline.md` (cross-module access rule, applied here specifically to AI), `API_CONTRACTS.md` (§13, AI API Principles).
- **Status:** Approved v1.0 — Locked.
- **Owner:** CTO / Principal Software Architect / AI Architect (BARQ core team).

---

## Context

BARQ is an AI-first platform (`PROJECT_MANIFEST.md` §7, `ARCHITECTURE_PRINCIPLES.md` Principle 8) building toward a growing set of AI Agent roles (`AI_STRATEGY.md` §3: Customer Assistant, Provider Assistant, Operations Assistant, Admin Assistant, Support Assistant, and others). Boundaries on what these agents may do have so far been stated across several documents — `AI_STRATEGY.md` §4's AI Boundaries, `DOMAIN_MODEL.md`'s single `AI Agent` invariant, `SYSTEM_ARCHITECTURE.md`'s architectural isolation of the AI Layer, and `API_CONTRACTS.md`'s AI API Principles. Each of those statements is correct, but none of them was written as the single, permanent, binding governance record — each was scoped to its own document's purpose (strategy, domain modeling, system architecture, API design respectively).

As BARQ moves toward specifying actual AI Agent roles in detail (`AI_AGENTS.md`, the next document in sequence), the project needs one authoritative, technology-independent record of the boundaries every future agent — regardless of what it does, which document specifies it, or which model implements it — must never cross. This ADR is written specifically to precede `AI_AGENTS.md`, the same pattern already established by `ADR-0002` preceding `SYSTEM_ARCHITECTURE.md` and `ADR-0005` preceding the documents its bilingual requirement binds.

## Problem Statement

Without one permanent, explicit governance record, AI Agent boundaries risk being reinterpreted, softened, or inconsistently applied as new agent roles are specified over time — a future `AI_AGENTS.md` revision, or a well-intentioned feature request, could plausibly propose "just this once" relaxing a boundary (e.g. letting an agent auto-approve low-risk Providers, or auto-issue small refunds) without that proposal ever being measured against a fixed, non-negotiable standard. `AI_STRATEGY.md` §4 already states absolute boundaries, but as a strategy document it is subject to a lower revision bar than an ADR — this ADR exists specifically to raise that bar for AI governance to the same permanence level as `PROJECT_MANIFEST.md`'s core commitments.

## Decision

The following 17 boundaries are permanent and binding on every AI Agent in BARQ, present and future, regardless of role, capability, or underlying technology:

1. **AI Agents are application actors, never system owners.** An AI Agent is a consumer of the system on the same architectural footing as any other authenticated actor (`SYSTEM_ARCHITECTURE.md` §12) — it never holds administrative or infrastructural authority over the platform itself.
2. **AI Agents never bypass authorization.** Every AI Agent request is authorized through the identical mechanism as any other caller (`API_CONTRACTS.md` §10) — there is no AI-specific authorization shortcut.
3. **AI Agents never access the database directly.** Consistent with `ADR-0006`'s cross-module access rule and `SYSTEM_ARCHITECTURE.md` §4 — the AI Layer has no direct persistence-layer access, full stop.
4. **AI Agents always operate through approved application services.** The only path from an AI Agent to any business capability is a governed Application Layer interface (`SYSTEM_ARCHITECTURE.md` §4) — never a bespoke, ungoverned integration point built for AI convenience.
5. **AI Agents never modify financial records directly.** `Wallet`, `Wallet Transaction`, `Payment`, `Invoice`, and `Commission` records (`DOMAIN_MODEL.md`) are never written to by an AI Agent directly — any financial consequence an AI Agent contributes to flows through the same human-approved paths any other actor uses.
6. **AI Agents never execute payouts.** No exception — Payout Processing (`DOMAIN_MODEL.md` Wallet context) is never AI-initiated to completion, consistent with `AI_STRATEGY.md`'s absolute Finance Assistant restriction.
7. **AI Agents never approve providers autonomously.** Provider Approval (`DOMAIN_MODEL.md` Provider lifecycle, Administration context authority) remains a human Admin decision in every case, without exception for volume, urgency, or apparent low risk.
8. **AI Agents never finalize legal contracts.** Contract signing (`DOMAIN_MODEL.md` Contract lifecycle) requires the human party's own action — an AI Agent may draft or summarize, never execute the binding step.
9. **AI Agents never delete audit records.** Consistent with `DATABASE_DESIGN.md` §9's Audit Log immutability requirement — this applies to AI Agents with exactly the same force it applies to any human actor, including Admins.
10. **AI Agents never bypass booking business rules.** Every `Booking` invariant in `DOMAIN_MODEL.md` (Availability, Price/Commission fixation, confirmation rules) applies to an AI-initiated Booking action exactly as it applies to a human-initiated one — no AI-specific exception path.
11. **AI Agents must always identify themselves as AI.** Consistent with `AI_STRATEGY.md` §2's Transparent Automation principle and `DESIGN_SYSTEM.md` §17's interface-level enforcement of the same rule — no AI Agent interaction is ever presented as originating from a human.
12. **Human approval is mandatory for:** Money, Contracts, Provider approval, Refunds, Disputes, Manual overrides, Configuration changes. This list is exhaustive of the categories named here, not illustrative — any new category of consequential action introduced by a future capability must be evaluated against this ADR's spirit (§17 below) before being treated as exempt.
13. **AI actions must be auditable.** Every action an AI Agent takes, not only the high-risk ones named in point 12, produces an Audit Log entry (`DATABASE_DESIGN.md` §9) — auditability is universal, human-approval-gating is targeted.
14. **AI actions must be reversible whenever possible.** Where a technically reversible alternative exists, an AI Agent's action is designed to use it (e.g. a draft that can be discarded, a recommendation that can be dismissed) rather than an irreversible one, even within its otherwise-Allowed Actions (`AI_STRATEGY.md` §3).
15. **Every AI action must include:** Actor, Timestamp, Reason, Confidence, Trace ID, Correlation ID. This is the minimum data shape every AI action's audit record must carry — consistent with `API_CONTRACTS.md` §5 (Correlation IDs) and §16 (Observability, Trace IDs) — not a suggestion but a structural requirement on every future AI Agent implementation.
16. **AI recommendations must never be represented as facts.** Consistent with `AI_STRATEGY.md` §2's Explainable Decisions principle and `API_CONTRACTS.md` §13's Confidence requirement — a recommendation is always distinguishable, in both the API contract and the interface (`DESIGN_SYSTEM.md` §17), from a retrieved fact.
17. **Human operators always have final authority.** Consistent with `PROJECT_MANIFEST.md` §7 and `ARCHITECTURE_PRINCIPLES.md` Principle 23 — no AI Agent capability, present or future, is ever specified in a way that removes a human's ability to override, halt, or reverse an AI-initiated process.

## Consequences

**Positive:** Every future AI Agent specification (`AI_AGENTS.md` and beyond) now has one fixed, technology-independent standard to be measured against, at the same permanence tier as `PROJECT_MANIFEST.md`'s core commitments — not a strategy-document guideline that could be softened by a future revision. This closes the gap `AI_STRATEGY.md` §4 left open: boundaries stated with the right intent but not yet at ADR-level permanence.

**Negative / Cost:** Every future AI capability that might have been convenient to build as a shortcut (e.g. an AI Agent with direct database read access for performance reasons) must instead go through the same governed Application Layer path as any other consumer — an ongoing engineering discipline cost, accepted deliberately in exchange for the trust and auditability this ADR protects.

**Follow-up Required:** `AI_AGENTS.md`, when written next, must cite this ADR as its governing constraint for every role it specifies — no AI Agent role may be defined with an Allowed Action that this ADR forbids. `AI_STRATEGY.md` §4 should be revised at its next update to cite this ADR as the now-authoritative, ADR-level source for its own boundaries, rather than standing as a parallel, lower-tier statement of the same rules.

## Alternatives Considered

- **Leave AI boundaries governed only by `AI_STRATEGY.md` §4, without a dedicated ADR:** Considered and rejected — a strategy document is revised at a lower bar than an ADR (`PROJECT_RULES.md` §10's Document Lifecycle allows strategy-document revision through normal Draft→Review cycles), which is an appropriate bar for strategy but not for a permanent safety boundary. AI governance specifically warrants the same elevated permanence `PROJECT_MANIFEST.md` itself has.
- **Define boundaries per-agent-role inside `AI_AGENTS.md` rather than as one shared ADR:** Considered and rejected — this would risk inconsistent boundary interpretation across roles (one role's spec stating a boundary slightly differently from another's) and would not give future roles a fixed standard to be checked against before they're even drafted.
- **Grant a narrow, pre-approved exception process for low-risk instances of otherwise-forbidden actions (e.g. auto-approving Providers below a defined risk score):** Considered and rejected — see Rejected Alternatives below; this is the specific temptation this ADR is written to foreclose.

## Rejected Alternatives

- **A risk-threshold exception for autonomous Provider approval:** Explicitly rejected. No risk-scoring model is trustworthy enough, at any threshold, to justify removing human judgment from Provider Approval — the entire trust model of the marketplace (`BUSINESS_MODEL.md` §5, §10) depends on verification being a genuine human gate, not a probabilistic one.
- **A "small amount" exception for autonomous refunds or payouts:** Explicitly rejected. Any monetary threshold chosen would be arbitrary, and arbitrary thresholds are exactly the kind of boundary that erodes over time through incremental raising — this ADR forecloses the category entirely rather than picking a number to defend later.
- **Allowing AI Agents read-only direct database access for performance reasons:** Explicitly rejected. The performance argument for bypassing the Application Layer is real but insufficient — it would create exactly the kind of privileged AI data path `AI_STRATEGY.md` §2's "AI Never Owns Business Data" principle and `DATABASE_DESIGN.md` §13's Business Memory rule were written to prevent. Performance needs are addressed through caching/read-model strategies already available to any consumer (`SYSTEM_ARCHITECTURE.md` §6, §10), not through an AI-specific shortcut.

## Trade-offs

Every boundary in this ADR trades some AI capability or convenience for trust, auditability, and reversibility. The project accepts this trade explicitly: BARQ's competitive position (`BUSINESS_MODEL.md` §11) is built on trust being the actual product, not a marketing claim — an AI capability that erodes trust in exchange for speed or automation would undermine the exact thing BARQ is trying to build. Where a future capability seems to need an exception to move fast, the correct response is to question the capability's design, not this ADR's boundary.

---

## Related Documents
- `AI_AGENTS.md` *(not yet written)* — the next document in sequence; every role it specifies must comply with this ADR
- `AI_STRATEGY.md` — §2, §4, the document this ADR formalizes and elevates to permanent governance
- `PROJECT_MANIFEST.md` — §7, `ARCHITECTURE_PRINCIPLES.md` Principle 23 — the founding commitments this ADR operationalizes
- `DOMAIN_MODEL.md` — the `AI Agent` entity's invariant, now superseded in authority by this ADR's fuller statement
- `SYSTEM_ARCHITECTURE.md` — §4, §6, §12 — the architectural isolation this ADR's database/authorization boundaries enforce
- `DATABASE_DESIGN.md` — §9, §13 — Audit Log immutability and Business Memory rules this ADR applies specifically to AI
- `API_CONTRACTS.md` — §13 — AI API Principles this ADR's Confidence and auditability requirements extend
- `DESIGN_SYSTEM.md` — §17 — the interface-level enforcement of this ADR's Transparency requirement (point 11)
- `ADR-0002-modular-monolith.md`, `ADR-0006-database-baseline.md` — architectural decisions this ADR's database/access boundaries are consistent with

## Open Questions
None outstanding. Both prior open items were resolved at Architecture Review:
1. **Resolved:** `AI_STRATEGY.md` should be updated later to reference this ADR as the authoritative AI boundaries record. This update is deferred, not immediate — `AI_STRATEGY.md` itself is not edited by this entry.
2. **Resolved:** Any new mandatory-human-approval category (beyond the seven named in point 12) must be added through a superseding ADR, not a routine document edit — this is now binding process, not an open question.

## Future ADR References
- Any proposal to relax, narrow, or add an exception to any of the 17 boundaries in this ADR requires a superseding ADR at the highest review tier — consistent with how `PROJECT_MANIFEST.md` treats its own core commitments. A boundary listed here is not renegotiable through a routine document update, including within `AI_AGENTS.md` itself.
- Any future addition of a new mandatory-human-approval category (point 12) should be recorded as an amendment via a superseding ADR, not a silent addition to this document after it is Locked.
