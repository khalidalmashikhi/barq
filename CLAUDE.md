# CLAUDE.md

BARQ (Arabic: **برق** — never "بارق") is a multi-language tourism marketplace for Oman, connecting travelers with verified local providers (accommodation, transport, restaurants, activities, and more). It is built as a single Next.js 15 / TypeScript / PostgreSQL application, API-first and mobile-ready by architectural mandate (ADR-0011), with 8 supported interface languages (ADR-0010).

## Before you touch anything

1. **Inspect before proposing.** Read the real repository state — this file's pointers, `docs/project-memory/01-CURRENT-STATE.md`, the actual schema/code — never rely on a doc's claim or a prior session's memory of what "should" be there.
2. **Preserve, don't rebuild.** Evolve existing routes, models, APIs, tests, and ADRs. Never delete, rename, or recreate a working file unless a task explicitly requires it and you've confirmed nothing depends on the old shape.
3. **Missing capabilities are added incrementally**, one scoped, approved phase at a time — never as a wholesale rewrite.
4. **Workflow, every non-trivial task**: inspect → analyze → plan → wait for explicit approval → implement in small verified batches → full verification suite → completion report. This applies even to tasks that look mechanical or low-risk.
5. **Never fabricate** — APIs, DB tables, routes, statistics, or business content that doesn't exist. State plainly when something doesn't exist rather than inventing it.
6. Auth, OTP, RBAC, payment integrity, and permission enforcement stay code-controlled. Business configuration (categories, pricing rules, commissions, translations, homepage content) moves toward admin-controlled *only where doing so is safe* — see `docs/project-memory/11-SECURITY-POLICY.md` for the exact dividing line.
7. **Every implementation phase from this point forward follows `docs/plans/EXECUTION_CONTRACT.md` (EC-001) without exception** — before/after reporting, quality gates, one-engine-at-a-time ordering, and the stop-and-wait condition after every phase are binding, not optional.

## Where the real memory lives

| File | What it's for |
|---|---|
| `docs/project-memory/00-PROJECT-VISION.md` | What BARQ is and its long-range direction |
| `docs/project-memory/01-CURRENT-STATE.md` | **Start here for any non-trivial task.** What's actually built vs. schema-only vs. absent |
| `docs/project-memory/02-BUSINESS-MODEL.md` | Business model, current + target |
| `docs/project-memory/03-PRODUCT-REQUIREMENTS.md` | The full product direction, as a living PRD |
| `docs/project-memory/04-ADMIN-PLATFORM.md` | Admin capabilities, current vs. target |
| `docs/project-memory/05-PROVIDER-EXPERIENCE.md` | Provider onboarding/experience, current vs. target |
| `docs/project-memory/06-TOURIST-EXPERIENCE.md` | Customer-facing experience, current vs. target |
| `docs/project-memory/07-CATEGORIES.md` | Target category model (not yet built) |
| `docs/project-memory/08-PRICING-COMMISSIONS.md` | Target financial/commission model vs. today's fixed 3-tier reality |
| `docs/project-memory/09-TRANSLATION-I18N.md` | i18n architecture (ADR-0005, ADR-0010) + target translation workflow |
| `docs/project-memory/10-COMMUNICATION-POLICY.md` | No-direct-contact-exposure policy, target messaging/support model |
| `docs/project-memory/11-SECURITY-POLICY.md` | What must stay code-controlled vs. what may become admin-controlled |
| `docs/project-memory/12-DECISIONS.md` | Running log of real decisions made, phase by phase |
| `docs/project-memory/13-OPEN-QUESTIONS.md` | Explicitly unresolved items — check before assuming an answer |
| `docs/project-memory/14-LESSONS-LEARNED.md` | Durable operational lessons (tooling gotchas, past mistakes) |
| `docs/project-memory/15-DATA-DICTIONARY.md` | Entity-level detail (purpose, relationships, status) for every major business entity |
| `docs/project-memory/16-BUSINESS-RULES.md` | The permanent, ID'd business rule registry (`BR-NNN`), each with an honest enforcement status |
| `docs/project-memory/17-CHANGELOG-DECISIONS.md` | The dated architectural/product decision timeline |
| `docs/project-memory/18-DOMAIN-MODEL.md` | Target Bounded Contexts, mapped honestly against the existing Locked `DOMAIN_MODEL.md` |
| `docs/project-memory/19-EVENT-CATALOG.md` | The domain event catalog (`DOMAIN_MODEL.md` §3's long-referenced, never-written `EVENTS.md`, drafted here) |
| `docs/project-memory/20-PERMISSION-MATRIX.md` | The concrete per-module permission grid operationalizing `IDENTITY_AND_ACCESS.md`'s philosophy |
| `docs/project-memory/21-ENGINE-SPECIFICATIONS.md` | Purpose/Responsibilities/Dependencies/Inputs/Outputs for every planned engine |
| `docs/project-memory/22-NON-FUNCTIONAL-REQUIREMENTS.md` | Performance/security/scalability/etc. — current state vs. target, one page |
| `docs/plans/ROADMAP.md` | High-level phased sequencing for the planned engines |
| `docs/plans/IMPLEMENTATION-PLAN.md` | Per-engine implementation scoping, filled in as each is approved |
| `BARQ_BIBLE.md` | Full documentation map and reading order by role — the architectural constitution (ADRs, domain model, tech stack) lives under `docs/00-foundation/` through `docs/11-release/`, indexed there |

The numbered `docs/` subdirectories (`00-foundation/` … `11-release/`) are the versioned, ADR-gated architecture record — update those through the ADR/RFC process in `docs/00-foundation/PROJECT_RULES.md`. `docs/project-memory/` is living working memory — update it freely as you learn things, no ADR gate required.

## Known, deliberately-unfixed inconsistency

`messages/ar/landing.json` uses the incorrect spelling **"بارق"** in 13 places; `messages/ar/common.json`'s `appName` correctly uses **"برق"**. Do not silently fix this in an unrelated task — it's tracked in `docs/project-memory/13-OPEN-QUESTIONS.md` for a dedicated content-correction pass.
