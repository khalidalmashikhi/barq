# 00 — Project Vision

## What BARQ is

BARQ (Arabic: **برق** — never "بارق") is a multi-language tourism marketplace for Oman, with GCC expansion as the longer-range ambition (per `docs/02-domain-architecture/TECH_STACK.md`'s framing). It connects travelers with verified local providers across categories including accommodation, transport, restaurants, and activities, aiming to be the trusted, government-grade platform for discovering and booking authentic Omani tourism experiences.

## Long-range vision: a configurable marketplace platform, not a hardcoded app

The direction captured in this phase (see `03-PRODUCT-REQUIREMENTS.md` for the full brief) is for BARQ to become **data-driven and admin-manageable** across everything that is safely business configuration rather than core security logic: categories and subcategories, visibility rules, pricing models, commissions, provider requirements, forms, homepage sections, and general business content. Concretely, this means 15 platform engines (listed in full in `AGENTS.md` and `../plans/ROADMAP.md`), most of which do not exist yet — see `01-CURRENT-STATE.md` for exactly what's real today versus target state.

## Explicit non-goals, right now

- No product code changes without an explicitly approved, scoped phase — this vision document and its siblings under `docs/project-memory/` are memory, not a green light to implement.
- No rebuild of any existing, working feature. Every engine above is additive to what already exists (booking lifecycle, contract engine, OTP auth, notifications, i18n) — never a replacement for it.
- No engine is built "just in case." Each ships when a real, scoped need justifies it, per `docs/00-foundation/PROJECT_RULES.md`'s YAGNI discipline.

## Architectural commitments that constrain how any of this gets built

- **API-first, mobile-ready** (ADR-0011) — any new engine's capabilities must be exposed via stable, versioned APIs, not Server-Action-only, so the same business logic serves Web, a future mobile app, AI agents, and future partners alike.
- **Bilingual-by-design, now 8 languages** (ADR-0005, ADR-0010) — Arabic and English are co-equal, RTL is designed-in not mirrored, and every new engine's content model must support all 8 locales from day one, not retrofitted later.
- **Code-controlled security core** — authentication, payment integrity, and permission enforcement never move to admin configuration, regardless of how "configurable" the rest of the platform becomes. See `11-SECURITY-POLICY.md`.
