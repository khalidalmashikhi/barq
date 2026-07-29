# ADR-0012 — Architecture Freeze v2: SaaS-Scope Deferral & BARQ-First Implementation Reset

**Purpose:** Formally close out the multi-tenant SaaS architecture review conducted in this project's memory this session (Business Profiles, Module Packs, Entitlement Engine, Capability Layer, Billing, Marketplace, Theme Engine, Company lifecycle) by recording, permanently, which parts of it are accepted as future architecture, which are deferred, and which are rejected for now — and by reasserting that BARQ's implementation priority is launching the tourism marketplace, not building a generic SaaS platform.

**Scope:** The outcome of the "Architecture v3 Final Review" analysis and the Platform Owner's subsequent "Phase 0.5 — Architecture Freeze & Implementation Reset" decision. Covers: Business Profiles, Module Packs (and their dependency/feature-sharing model), Entitlement Engine, Limits/Quota model, Company lifecycle, Storefront Templates/Theme Engine, Capability Layer, Billing as a bounded context, Marketplace as a bounded context, and the resulting freeze of `docs/plans/ROADMAP.md`'s phase order.

**Out of Scope:** Does not reopen, reverse, or supersede any existing Locked ADR (`ADR-0002`, `ADR-0004`–`ADR-0011`). Does not itself implement any schema, migration, or application code. Does **not** affect `docs/08-governance/ARCHITECTURE_FREEZE_V1.md` — that document freezes a different, earlier thing (BARQ's original ~20 foundational architecture documents plus ADRs `0002`/`0004`–`0008`) and remains fully in force, unmodified, unrenamed. This ADR is an additive record layered on top of it, not a replacement — see "Relationship to `ARCHITECTURE_FREEZE_V1.md`" below.

**Dependencies:** `ADR-0002` (Modular Monolith, Bounded Contexts), `ADR-0005`/`ADR-0010` (bilingual/8-language i18n), `ADR-0011` (API-first, mobile-ready), `docs/08-governance/ARCHITECTURE_FREEZE_V1.md`.

**Status:** Approved, Locked.

**Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Relationship to `ARCHITECTURE_FREEZE_V1.md`

`docs/08-governance/ARCHITECTURE_FREEZE_V1.md` is a different, earlier document. It closed BARQ's original architecture-definition phase — the foundational documents and ADRs that describe what BARQ *is* (a bilingual tourism marketplace, modular monolith, Next.js/Postgres/Prisma stack). Its own Exit Criteria anticipate exactly this situation: the freeze ends only on "a major product pivot" or "an ADR supersedes the architecture" — normal, expected evolution, not a breach.

This ADR is that normal evolution, not a pivot. It does not change what BARQ is; it closes out a detour where a much larger, generic multi-tenant SaaS architecture was explored, and confirms BARQ's scope reverts to exactly what `ARCHITECTURE_FREEZE_V1.md` already locked, with a small number of additive, ADR-gated extensions (§2 below). Titling this "Freeze v2" reflects that it is the second governance freeze event in this project's history, not a second copy of the first one — hence the distinct filename and ADR number, so the two documents are never confused or accidentally overwritten for one another.

## Context

Following Production Hardening (Phase 5.2) and a documentation-only "Project Memory Enhancement" effort, a broader question was raised: could BARQ's architecture support a decade of growth, including a hypothetical future as a multi-tenant SaaS platform serving verticals beyond tourism? A review process (internally: Architecture v2 → v3) proposed a substantial set of SaaS-shaped concepts — Business Profiles, Module Packs with many-to-many dependencies, a shared Feature model, an Entitlement Engine, a rich Quota model, an expanded Company lifecycle, an independent Theme Engine, a Capability Layer, and Billing/Marketplace as formal bounded contexts.

Before any of this reached implementation, the Platform Owner made an explicit scope call: **BARQ is not becoming a generic SaaS platform. BARQ remains a tourism marketplace.** The architecture may be shaped to *support* future expansion, but implementation must optimize for launching BARQ as soon as possible. This ADR is the permanent record of that call, so the review's conclusions are neither lost (parts remain valid documented direction for a possible future) nor mistaken for a build order (none of it is being implemented now).

## Architecture Decision

1. **Reaffirmed, already-Locked architecture** (no change, cited for completeness): API-first architecture (`ADR-0011`); 8-language interface target (`ADR-0010`); modular monolith with Bounded Contexts (`ADR-0002`).

2. **Accepted as documented future architecture — NOT implemented until a concrete BARQ requirement exists:**
   - **Marketplace as an official Bounded Context** — owns Categories, Discovery, Search, Featured/Campaigns, Visibility, Recommendations. The Homepage page-shell stays with Content/CMS in a producer/consumer relationship to Marketplace, not inside it.
   - **Billing as an architectural Bounded Context only** — reserves the seam (no `Subscription`/`Invoice`/`PaymentMethod`/`Usage`/`Coupon`/`Promotion`/`Renewal`/`Trial`/`GracePeriod`/`Seat` entities are created by this ADR) so a future billing need is never bolted onto Booking or the Financial Engine by accident.
   - **Theme Engine kept independent of any future entitlement/Module-Pack system** — themes would declare required features, not the reverse. No Theme Engine exists or is scheduled; this only fixes its shape *if* one is ever built.
   - **Business Profiles remain onboarding presets only** — a provider-onboarding UX convenience, not a richer classification or segmentation system.
   - **Module Packs remain part of long-term architecture, with dependencies and feature-sharing modeled many-to-many if ever built** — any future Pack-to-Pack dependency graph is many-to-many (never a single `depends_on_module_pack_id` FK), and any future Feature is shareable across Packs via a many-to-many pivot (never a strict one-Pack-owns-one-Feature relationship). Nothing here schedules this work.

3. **Rejected for now** — may be reconsidered only against a concrete, evidenced BARQ requirement, never as speculative future-proofing:
   - **Capability Layer** (`Plan → Pack → Capability → Feature`) — rejected as premature indirection over the simpler `Plan → Pack → Feature` shape, itself unbuilt.
   - **Generic SaaS abstractions BARQ does not currently need** — the Entitlement Engine's full multi-method surface, the rich Quota model (reset policy, soft/hard enforcement), the expanded multi-state Company lifecycle, Storefront Templates as an entity distinct from the Theme Engine.
   - **Any additional architecture layer, of any kind, that would delay BARQ's launch.**

4. **Implementation Philosophy — "BARQ First"** (binding on all future work): do not build for hypothetical customers, future products, or unknown verticals.
   - If BARQ needs it now: build it.
   - If BARQ may need it in two years: document it. Do not implement it.

5. **Implementation Priority** (binding ordering when priorities conflict, never reversed): (1) Launch BARQ, (2) High quality, (3) Future extensibility.

6. **Roadmap freeze** — `docs/plans/ROADMAP.md`'s phase sequencing is reset to the 10-phase order (Phase 0 through Phase 9) recorded in that document as of this ADR. No additional phases may be introduced without a separate, explicit approval; this ADR is the governing authority for that constraint, superseding the prior 9-phase order recorded in `docs/project-memory/17-CHANGELOG-DECISIONS.md`.

## Consequences

**Positive:**
- Prevents scope creep into a multi-tenant SaaS product BARQ does not need yet, while still preserving the modular-monolith/bounded-context discipline of `ADR-0002`.
- Records genuinely useful new seams (Marketplace, Billing, Theme Engine) for future use without committing to build them now.
- Gives every future phase a single, unambiguous scope test: *does BARQ need this now?*

**Negative:**
- The deferred SaaS concepts (Module Packs, Entitlement Engine, Capability-Layer debate) remain undesigned beyond this summary — a future team revisiting multi-tenancy will need to re-derive implementation specifics.
- Marketplace and Billing exist only as named seams, not code — nothing technically prevents a future phase from building against them incorrectly without first reading this ADR.

## Documentation

This ADR requires: `docs/plans/ROADMAP.md` rewritten to the frozen 10-phase order (delivered alongside this ADR); one new entry in `docs/08-governance/DEVELOPMENT_LOG.md`; one new line in `BARQ_BIBLE.md`'s ADR Index.

## Related Documents

- `docs/08-governance/ARCHITECTURE_FREEZE_V1.md` — the original, still-in-force foundational freeze; distinct scope, not superseded.
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`, `ADR-0010-multilingual-architecture-expansion.md`, `ADR-0011-api-first-mobile-ready-architecture.md`.
- `docs/project-memory/18-DOMAIN-MODEL.md`, `19-EVENT-CATALOG.md`, `21-ENGINE-SPECIFICATIONS.md` — touch related bounded-context vocabulary; unaffected by this ADR.
- `docs/plans/ROADMAP.md`.

## Open Questions

None blocking. Deferred items in §2/§3 are deferred, not open engineering questions. If a concrete BARQ requirement for Billing, Module Packs, or Marketplace-as-code surfaces, record that requirement in `docs/project-memory/13-OPEN-QUESTIONS.md` before drafting any implementation ADR.

## Future ADR References

Any future ADR implementing Marketplace, Billing, Theme Engine, or Module Packs as real code must cite this ADR-0012 as its governing precedent, and may not reintroduce the Capability Layer or other §3-rejected items without a new ADR explicitly reversing that rejection.
