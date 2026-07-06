# BARQ Bible

- **Purpose:** The navigation layer of BARQ. The single entry point for humans and AI coding agents to understand how BARQ is organized and where the authoritative answer to any question lives. This document never duplicates documentation — if information exists elsewhere, this document links to it.
- **Scope:** Project constitution/hierarchy, documentation map, platform/domain/technology/security/experience maps, engineering workflow pointer, implementation roadmap (phases only), role-based reading order, ADR index, and living documents.
- **Out of Scope:** Any actual documentation content, any architectural decision, any implementation. This document is navigation only.
- **Dependencies:** Every document it maps. This document has no authority independent of what it points to.
- **Status:** Approved v1.0 — Living Document. Continuously updated for navigation, cross-reference, index, and reading-order changes without an ADR; see Important Rules below.
- **Owner:** CTO / Principal Software Architect / Product Manager / AI Architect (BARQ core team).

---

## Executive Summary

BARQ is a premium Smart Tourism Operations Platform launching in Salalah, Oman, then expanding across Oman and the GCC — a managed marketplace connecting travelers with verified Service Providers (drivers, guides, tour operators, fleet owners), built mobile-first, Arabic-first, and AI-first from day one. Its full Vision, Mission, and Product Philosophy are owned entirely by `PROJECT_MANIFEST.md` — referenced here, never restated. If you read nothing else in this project, read that document first; everything else, including this one, exists beneath it.

## Project Constitution

Authority in BARQ flows in one direction, strictly:

```
PROJECT_MANIFEST.md          (the constitution — why BARQ exists, permanent)
        ↓
PROJECT_RULES.md              (how BARQ operates — process, permanent)
        ↓
Approved ADRs                 (specific binding decisions)
        ↓
Architecture Documents        (SYSTEM_ARCHITECTURE, DATABASE_DESIGN, API_CONTRACTS,
                                TECH_STACK, SECURITY, AUTHENTICATION, IDENTITY_AND_ACCESS,
                                AI_STRATEGY, AI_AGENTS, DESIGN_SYSTEM, LOCALIZATION,
                                ACCESSIBILITY, DEPLOYMENT_AND_INFRASTRUCTURE, DOMAIN_MODEL)
        ↓
ENGINEERING_GUIDE.md          (daily practice)
        ↓
Implementation                (code)
```

**A lower level may never contradict a higher one.** Implementation may never contradict the Engineering Guide's practice, which may never contradict an Architecture Document, which may never contradict an Approved ADR, which may never contradict `PROJECT_RULES.md`, which may never contradict `PROJECT_MANIFEST.md`. Where a genuine conflict is discovered, it is resolved by correcting the lower level to match the higher one — or, if the higher level itself needs to change, through a superseding ADR at the appropriate review tier, never by letting the lower level quietly win.

## Documentation Map

| Category | Purpose | Primary Documents | Owner |
|---|---|---|---|
| **00 Foundation** | Terminology, process rules, AI philosophy, and daily engineering practice — the documents everything else depends on. | `GLOSSARY.md`, `PROJECT_RULES.md`, `AI_STRATEGY.md`, `ENGINEERING_GUIDE.md` | CTO / Principal Architect |
| **01 Business & Product** | Why BARQ makes money and what it builds. *Note: `PRODUCT_REQUIREMENTS.md` physically lives in `docs/01-product/`, distinct from `docs/01-business/`, but both are grouped here as one navigational category.* | `BUSINESS_MODEL.md`, `PRODUCT_REQUIREMENTS.md` | Product Manager / CTO |
| **02 Domain Architecture** | The business domain and the technical architecture built on it. | `ARCHITECTURE_PRINCIPLES.md`, `DOMAIN_MODEL.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_CONTRACTS.md`, `TECH_STACK.md` | Principal Software Architect |
| **03 Platform Capabilities** | Identity, access, and AI agent specifications. | `AUTHENTICATION.md`, `IDENTITY_AND_ACCESS.md`, `AI_AGENTS.md` | CTO / AI Architect |
| **04 Experience** | Design, localization, and accessibility architecture. | `DESIGN_SYSTEM.md`, `LOCALIZATION.md`, `ACCESSIBILITY.md` | Design Lead / Principal Architect |
| **05 Trust & Compliance** | Security architecture. | `SECURITY.md` | CTO / Security Lead |
| **06 Quality** | Testing strategy and third-party integration governance. **Not yet written** — flagged honestly rather than implied complete. | *(none yet — `TESTING_STRATEGY.md`, `INTEGRATIONS.md` remain outstanding)* | Unassigned |
| **07 Infrastructure** | Deployment and operational infrastructure. | `DEPLOYMENT_AND_INFRASTRUCTURE.md` | CTO / Principal Architect |
| **08 Governance** | ADRs, the Architecture Freeze, and the living development record. | `ARCHITECTURE_FREEZE_V1.md`, `DEVELOPMENT_LOG.md`, all ADRs | CTO |

## BARQ Platform Map

High-level modules only — each maps to `DOMAIN_MODEL.md`'s Bounded Contexts; none of this is redefined here:

- **Booking** → Booking context (`DOMAIN_MODEL.md` §1)
- **Provider** → Provider context
- **Customer** → Customer context
- **Operations** → Operations context (includes Support Ticket handling — see `SYSTEM_ARCHITECTURE.md` §5's note on this fold-in)
- **Finance** → Pricing, Payments, Wallet, and Invoicing contexts collectively (no single "Finance" context exists in `DOMAIN_MODEL.md`; this is a platform-map grouping of four related contexts)
- **Support** → Operations context (same fold-in as above, not a separate context)
- **Tracking** → Tracking context
- **AI** → AI context
- **Notifications** → Notifications context
- **Administration** → Administration context

Full definitions, ownership, invariants: `DOMAIN_MODEL.md`.

## AI Architecture Map

Every AI Agent, purpose only — full specification in `AI_AGENTS.md`, absolute boundaries in `ADR-0008-ai-agent-boundaries.md`:

- **Customer Assistant** — Customer-facing discovery/booking/support help.
- **Provider Assistant** — Provider onboarding, listing, and performance guidance.
- **Operations Assistant** — Real-time monitoring and dispatch support (never autonomous dispatch).
- **Support Assistant** — Ticket triage and response drafting.
- **Finance Assistant** — Invoice/Commission/Wallet explanation (never payouts, never balance modification).
- **Admin Assistant** — Reports, analytics, configuration advice (never configuration changes).
- **Knowledge Assistant** — Approved-knowledge retrieval for any human or agent.
- **Marketing / Documentation / Developer Assistants** — named at the strategy level (`AI_STRATEGY.md` §3) only; not yet detailed in `AI_AGENTS.md`.

No AI Agent, present or future, may exceed `ADR-0008`'s 17 boundaries. That ADR is the permanent ceiling; `AI_AGENTS.md` is the floor beneath it.

## Domain Map

All 15 Bounded Contexts, listed only — full definitions in `DOMAIN_MODEL.md` §1:

Identity, Customer, Provider, Booking, Operations, Pricing, Payments, Wallet, Contracts, Invoicing, Notifications, Tracking, Reviews, Administration, AI.

## Technology Map

Reference only — full reasoning in `TECH_STACK.md`:

- **Frontend:** Next.js, React, TypeScript.
- **Backend:** Next.js Route Handlers / Server Actions, Node.js LTS.
- **Database:** PostgreSQL, Prisma ORM.
- **Hosting:** Vercel.
- **AI Gateway:** LLM Gateway abstraction over candidate providers (OpenAI, Anthropic/Claude).

## Security Map

Reference only — no content restated:

- **Authentication:** `AUTHENTICATION.md`
- **Identity & Access:** `IDENTITY_AND_ACCESS.md`
- **Security Architecture:** `SECURITY.md`
- **AI Boundaries:** `ADR-0008-ai-agent-boundaries.md`

## Experience Map

Reference only — no content restated:

- **Design System:** `DESIGN_SYSTEM.md`
- **Localization:** `LOCALIZATION.md`
- **Accessibility:** `ACCESSIBILITY.md`

## Engineering Workflow

Fully owned by `ENGINEERING_GUIDE.md` and `PROJECT_RULES.md` — not duplicated here. In one sentence: Documentation → Design → Architecture → ADR (if required) → Implementation → Testing → Documentation Update, enforced through code review and CI/CD, never bypassed for convenience.

## Implementation Roadmap

Phases only, no timelines — full detail in `PRODUCT_REQUIREMENTS.md` §12:

1. **V1** — Salalah launch: the MVP scope already fixed in `PRODUCT_REQUIREMENTS.md` §5.
2. **V1.5** — Expanded Trust Score, Support/Dispute maturity, additional AI roles.
3. **V2** — Oman-wide expansion, additional Provider categories, enterprise/API exploration.
4. **V3** — GCC expansion, multi-tenancy activation, native mobile apps.
5. **Long-Term** — Per `PROJECT_MANIFEST.md` §13 and `BUSINESS_MODEL.md` §16.

## Documentation Reading Order

| Role | Read First |
|---|---|
| **CEO** | `PROJECT_MANIFEST.md` → `BUSINESS_MODEL.md` → `PRODUCT_REQUIREMENTS.md` §1–§5 |
| **Investor** | `PROJECT_MANIFEST.md` → `BUSINESS_MODEL.md` |
| **Project Manager** | `PROJECT_MANIFEST.md` → `PRODUCT_REQUIREMENTS.md` → `PROJECT_RULES.md` → this document's Implementation Roadmap |
| **Backend Engineer** | `PROJECT_RULES.md` → `ARCHITECTURE_PRINCIPLES.md` → `DOMAIN_MODEL.md` → `SYSTEM_ARCHITECTURE.md` → `DATABASE_DESIGN.md` → `API_CONTRACTS.md` → `ENGINEERING_GUIDE.md` |
| **Frontend Engineer** | `PROJECT_RULES.md` → `DESIGN_SYSTEM.md` → `LOCALIZATION.md` → `ACCESSIBILITY.md` → `API_CONTRACTS.md` → `ENGINEERING_GUIDE.md` |
| **UI Designer** | `PROJECT_MANIFEST.md` §8 → `DESIGN_SYSTEM.md` → `LOCALIZATION.md` → `ACCESSIBILITY.md` |
| **AI Engineer** | `AI_STRATEGY.md` → `ADR-0008-ai-agent-boundaries.md` → `AI_AGENTS.md` → `SYSTEM_ARCHITECTURE.md` §4–§6 |
| **QA** | `PRODUCT_REQUIREMENTS.md` §15 → `ENGINEERING_GUIDE.md` §7 → `ACCESSIBILITY.md` → `LOCALIZATION.md` |
| **Hermes / Claude / Cursor / Copilot** (AI coding agents) | `PROJECT_RULES.md` → `ARCHITECTURE_PRINCIPLES.md` → `ENGINEERING_GUIDE.md` → the specific Architecture Document(s) governing whatever module the task touches, per this document's Documentation Map — never implementation without first locating the governing document. |

## ADR Index

Every architectural decision that is expensive to reverse is recorded as an ADR, per `PROJECT_RULES.md` §4. Current Approved ADRs:

- `ADR-0002` — Modular Monolith
- `ADR-0004` — Project Manifest (its existence above `BARQ_BIBLE.md`'s own charter)
- `ADR-0005` — Bilingual Architecture
- `ADR-0006` — Database Baseline
- `ADR-0007` — Frontend, Backend, and Hosting Stack
- `ADR-0008` — AI Agent Boundaries

**A known gap, stated plainly:** `ADR-0001` (documentation architecture) and `ADR-0003` (documentation order) were referenced by name in this project's early history but were never created as standalone files — both are largely superseded in practice by `PROJECT_RULES.md`'s later Progressive Documentation rules and by `ARCHITECTURE_FREEZE_V1.md` itself. They are not fixed in this pass; whether they should be reconstructed for historical completeness or formally retired is an open item for whoever governs this project's ADR history next.

**ADR Workflow:** Draft v0.1 → Architecture Review → Draft v0.2 (if revised) → Review → Approved v1.0 → Locked. Once Locked, an ADR changes only through a superseding ADR — never a direct edit. Full process: `PROJECT_RULES.md` §4.

## Living Documents

- **`CHANGELOG.md`** — intended to record user-facing/release-level changes over time. **Not yet created.**
- **`PROJECT_STATUS.md`** — intended to give a current, at-a-glance snapshot of what's built, in progress, and planned. **Not yet created.**
- **`DEVELOPMENT_LOG.md`** — the actual, currently-maintained record of every AI-generated or AI-modified document/code change, and key process milestones. Living, never Locked, per its own Status. This is the one Living Document that has been consistently maintained throughout this project's history so far.

## Important Rules

- **SSOT:** Every fact lives in exactly one document. This document restates none of them.
- **No Duplication:** If you find content here that also exists in a linked document, that is a defect in this document, not an intentional second source. `BARQ_BIBLE.md` always references the authoritative document — it never duplicates one.
- **No Implementation:** This document contains no code, no schema, no configuration.
- **No Architectural Decisions:** This document makes none — it only shows where they live. `BARQ_BIBLE.md` has no architectural authority of any kind. All architectural decisions remain owned exclusively by `PROJECT_MANIFEST.md`, `PROJECT_RULES.md`, Approved ADRs, and the Architecture Documents (per the Project Constitution above) — never by this document.
- **BARQ_BIBLE is Navigation Only.** If you came here looking for an answer, this document's job is to send you to where the answer actually lives, not to answer it here.
- **Living-Document Update Exception:** `BARQ_BIBLE.md` may be updated without an ADR when the update is limited to navigation, cross-references, the document index, reading order, document locations, or documentation links — provided no architectural meaning changes as a result. Any update that changes what a document *means*, rather than where it lives or how it's found, is not covered by this exception and follows the normal governance for whatever it actually touches.

---

## Related Documents
- Every document named throughout this map — this document has no content independent of them.

## Future ADR References
- Any change to the Project Constitution's hierarchy (above) is itself a governance-level change requiring an ADR, consistent with how `PROJECT_MANIFEST.md` and `ADR-0004` already treat that hierarchy's top two levels.
- Resolution of the `ADR-0001`/`ADR-0003` gap (ADR Index, above), if pursued, should itself be recorded as a decision — either their reconstruction or their formal retirement — not a silent removal from future citation.
