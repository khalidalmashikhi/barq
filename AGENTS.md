# AGENTS.md

Instructions for any AI coding agent (tool-agnostic — the same rules apply whether you're Claude, Copilot, Cursor, or any future assistant) working on BARQ.

BARQ (Arabic: **برق** — never "بارق") is a multi-language tourism marketplace for Oman. Single Next.js 15 / TypeScript / PostgreSQL application (not a monorepo), API-first and mobile-ready (ADR-0011), 8 supported interface languages (ADR-0010): Arabic (default, RTL), English, German, Italian, Polish, French, Czech, Russian.

## Nine permanent working rules

1. Do not delete, rename, or recreate existing project files unless strictly necessary — and never without first confirming nothing depends on the current shape.
2. Do not rebuild any part of the project from scratch.
3. Preserve every existing working feature, route, database model, API, test, configuration, ADR, and architectural decision.
4. Inspect what already exists before proposing anything — read real files, not a doc's claim or a memory of a prior session.
5. Evolve the existing implementation; do not discard it.
6. Add missing capabilities incrementally, one scoped phase at a time.
7. Stay within the requested scope for a given task — documentation-only phases make documentation changes only, code phases make code changes only.
8. Follow the sequence: analysis → explicit approval → implementation. Do not implement past what was approved.
9. When asked to stop after analysis, stop — do not create or edit files until told to proceed.
10. **Every implementation phase follows `docs/plans/EXECUTION_CONTRACT.md` (EC-001)** — a permanent, binding contract governing before/after reporting, quality gates, one-engine-at-a-time ordering, and the stop-and-wait condition after every phase. It does not replace rules 1–9 above; it operationalizes them for implementation work specifically.

## Start here for any task

Read `docs/project-memory/01-CURRENT-STATE.md` first — it is the as-built inventory of what's real, what's schema-only-with-no-implementation, and what's entirely absent. Do not assume a capability exists because it's named in `docs/project-memory/03-PRODUCT-REQUIREMENTS.md` — that file describes the target, not the current state. For entity-level detail, see `docs/project-memory/15-DATA-DICTIONARY.md`; for the specific, ID'd business rules governing a capability (with an honest enforcement status — verified in code vs. target), see `docs/project-memory/16-BUSINESS-RULES.md`; for the dated decision history behind any of this, see `docs/project-memory/17-CHANGELOG-DECISIONS.md`. For the target Bounded Contexts, see `docs/project-memory/18-DOMAIN-MODEL.md`; for domain events, `docs/project-memory/19-EVENT-CATALOG.md`; for who may do what, `docs/project-memory/20-PERMISSION-MATRIX.md`; for a per-engine spec, `docs/project-memory/21-ENGINE-SPECIFICATIONS.md`; for non-functional requirements, `docs/project-memory/22-NON-FUNCTIONAL-REQUIREMENTS.md`.

## The long-range direction (not yet built — see 01-CURRENT-STATE.md for what's real today)

BARQ's product direction calls for 15 platform engines, in no particular ship order yet (see `docs/plans/ROADMAP.md` for proposed sequencing):

1. Business Engine — data-driven categories, subcategories, pricing models, commissions, provider requirements, forms, homepage sections, business content
2. Dynamic Category Management — PUBLIC / HIDDEN / LINK_ONLY / INVITE_ONLY / SCHEDULED / ARCHIVED visibility, admin-toggleable without code changes
3. Form Builder — category-specific, configurable provider/service forms
4. Workflow Engine — generic, admin-configurable state machines (today: two hardcoded domain-specific ones exist for bookings and contracts — see `01-CURRENT-STATE.md`)
5. Rule Engine — generic business-rule evaluation
6. Notification Engine — multi-channel, admin-configurable triggers (today: one-way WhatsApp/Email/SMS only)
7. Financial and Commission Engine — percentage / fixed / hybrid / zero / manually-agreed commission; gross/discount/tax/net/paid/outstanding/settlement/transfer tracking
8. Translation Management — AI-assisted workflow with review states for provider-generated content (today: fully static, developer-curated JSON files)
9. CMS and Dynamic Homepage — database-driven homepage sections (today: 3 of 12 sections are DB-driven, the rest are static JSX)
10. Feature Flags
11. Provider Onboarding and Approval — individual vs. commercial distinction, category-specific requirements, document uploads (today: a 4-field form and a single approve action)
12. Support / "ساعدني" Ticket Center (today: schema-only `SupportTicket` model, zero implementation)
13. Internal Messaging Center (today: does not exist — "Contact Provider" is an honestly-disabled placeholder)
14. AI Center (today: schema-only `AIAgent` model, zero implementation, governed by ADR-0008's 17 permanent AI boundaries)
15. Audit Trail and Permission Engine (today: `AuditLog` + `BookingStatusEvent`/`BookingContractEvent` write-only, no viewer UI; RBAC is 4 fixed roles, not granular permissions)

## What stays code-controlled vs. what may become admin-controlled

Core security, authentication, payment integrity, and permission enforcement must remain code-controlled, always. Business configuration (categories, pricing rules, commissions, translations, homepage content) may become admin-controlled where doing so is safe. See `docs/project-memory/11-SECURITY-POLICY.md` for the exact boundary and ADR-0008's AI Agent Boundaries for what an AI agent specifically may never do autonomously (touch money, approve providers, finalize contracts, bypass authorization).

## Documentation registers — know which one you're in

- `docs/00-foundation/` through `docs/11-release/` (12 numbered subdirectories) plus `docs/08-governance/adr/` — the versioned, ADR-gated architectural constitution. Changing these requires the ADR/RFC process in `docs/00-foundation/PROJECT_RULES.md`.
- `docs/project-memory/` — living AI-agent working memory. Update freely as you learn things; no ADR gate.
- `docs/plans/` — forward-looking roadmap and per-engine implementation plans. Update as scoping decisions are made; not settled fact until an engine's own phase is approved.

Full documentation map and reading order by role: `BARQ_BIBLE.md`.
