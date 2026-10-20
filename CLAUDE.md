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

## Engineering workflow (binding — enforced by `.claude/settings.json`, the guard hook and CI)

Full procedure: `docs/project-memory/24-RELEASE-AND-ROLLBACK-RUNBOOK.md`. Reusable skills: `/barq-preflight`, `/barq-validate`, `/barq-staging-rollout`, `/barq-postdeploy-check`, `/barq-production-readiness`, `/barq-rollback-plan`.

- **Branches.** `feat|fix|docs|chore/*` = work · `staging` = integration, auto-deploys Vercel `barq-staging` · `main` = production, auto-deploys Vercel `barq`. Default target is **staging only**.
- **Production hard stop.** Never push / merge to `main`, never `vercel --prod / promote / rollback / alias / env`, never change production config — unless the owner's message in the *same task* explicitly authorizes production for a named SHA. Readiness assessment only otherwise.
- **Preflight first** (`/barq-preflight`): branch, HEAD, clean tree, `origin/staging` drift, what staging actually serves, migrations, scope boundary — then plan and **wait for approval**.
- **Clean tree, no drift.** Commit only intended files; never discard the user's changes. Before any push: `node scripts/engineering/prepush-check.mjs` (clean tree, fast-forward, no remote drift, never `main`).
- **History is append-only.** No `--force`, `reset --hard`, `clean -f`, `rebase`, `--amend`, `branch -D`, `--no-verify`. Fix forward with new commits.
- **Migrations.** Additive by default; a new migration needs explicit approval; applied migrations are never edited / renamed / deleted (`check-migrations.mjs`). Agents never run `migrate dev|deploy|reset`, `db push` or raw SQL against a shared database — staging migrates only through the `barq-staging` build. DROP / type change / rename / data rewrite needs a migration-safety review and a backup point.
- **No rule bypass, no direct DB deletion.** Change data only through the domain's supported operations; never delete or hand-edit rows to "undo" something.
- **Data boundaries.** Public DTOs use allowlists; provider-private and registration data (plate, VIN, engine number, civil number, owner name, documents) never reach customer surfaces, logs, analytics or the client bundle. Never use a real registration document or unredacted screenshot in tests or QA.
- **AuthN / AuthZ stay in code**: session-derived identity, server-side RBAC (`requireAdmin` / `requirePermission` / ownership checks) on every mutation and API route; never trust a client-supplied id or role.
- **Translations.** Every user-visible string is a key in all 8 locales with the same keys and ICU arguments (`translation-parity.mjs`; the completeness test). Arabic is the default and RTL.
- **Visual QA is mobile and Arabic-first**: 375×812 RTL, then 430×932, English LTR, desktop 1440, 200 % text; synthetic data; the owner signs in on staging (agents never use the owner's credentials).
- **Validation** (`/barq-validate`, each separately, exact exit codes; never the full suite and the build at once): `git diff --check` · scope / secret / migration / translation scripts · `npm run typecheck` · ESLint on touched files · `npx prisma validate` · focused tests · `npm run test` · `npm run build` · `bundle-scan.mjs`.
- **Deployed SHA, not hope.** After a push: `node scripts/engineering/verify-deploy.mjs --project barq-staging --expect <sha>` (deployment Ready, alias, built-from SHA, migration result, health). The `barq` preview build failing `validate-env` is cosmetic.
- **Docs follow-up** after every staging rollout: `17-CHANGELOG-DECISIONS.md` + `01-CURRENT-STATE.md` in one docs-only commit, verified like code.
- **Secrets.** Never print, read, copy or commit tokens, keys, cookies, OTPs, connection strings or env values (report only SET / EMPTY). Never create or change GitHub / Vercel secrets or environment variables — owner only.
- **Never** `--dangerously-skip-permissions` or bypass-permissions mode; never weaken a guard, test or CI check to make it pass.

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
| `docs/project-memory/23-REGISTRATION-OCR-PRIVACY-GATE.md` | **Operational gate (OPEN) for external OCR of vehicle-registration documents** — exposure, 9 preconditions (assessment, vendor terms/DPA, retention, privacy policy, geography, notice version, cost controls, live test, sign-off), what the code guarantees, honest limits |
| `docs/project-memory/24-RELEASE-AND-ROLLBACK-RUNBOOK.md` | **Controlled delivery path**: branch → PR → CI → staging → QA → owner-approved production; rollback (code / env / database limits); incident record; owner actions |
| `docs/plans/ROADMAP.md` | High-level phased sequencing for the planned engines |
| `docs/plans/IMPLEMENTATION-PLAN.md` | Per-engine implementation scoping, filled in as each is approved |
| `BARQ_BIBLE.md` | Full documentation map and reading order by role — the architectural constitution (ADRs, domain model, tech stack) lives under `docs/00-foundation/` through `docs/11-release/`, indexed there |

The numbered `docs/` subdirectories (`00-foundation/` … `11-release/`) are the versioned, ADR-gated architecture record — update those through the ADR/RFC process in `docs/00-foundation/PROJECT_RULES.md`. `docs/project-memory/` is living working memory — update it freely as you learn things, no ADR gate required.

## Brand spelling (resolved)

The Arabic brand name is **"برق"** (never "بارق"). A prior note flagged ~13 incorrect **"بارق"** spellings in `messages/ar/landing.json`; a repository-wide check during the Customer Experience Polish gate found **zero** occurrences of "بارق" anywhere under `messages/` — every Arabic brand mention already uses the correct "برق". The inconsistency is fixed; keep it that way.
