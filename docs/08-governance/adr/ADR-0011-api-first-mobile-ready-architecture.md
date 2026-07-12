# ADR-0011: API First & Mobile Ready Architecture

- **Purpose:** Establish BARQ as an API-first platform, designed from the beginning so that Web, native iOS, native Android, AI Agents, and future partner integrations can all be served without ever duplicating business logic per consumer. This ADR does not replace `ADR-0005` (Bilingual Architecture) or `ADR-0010` (Multilingual Architecture Expansion) — it complements them: those ADRs govern *what language* BARQ speaks to every client; this ADR governs *how every client gets served at all*, on a shared backend, regardless of language.
- **Scope:** The binding requirement that business capabilities be exposed through stable, versioned APIs rather than trapped in web-only mechanisms; the requirement that business logic (validation, pricing, booking, availability, permissions, contracts, payments, notifications, commissions, and future AI workflows) exist in exactly one reusable place, never duplicated per client platform; the expectation (pending its own future ADR if changed) that future native mobile apps use React Native/Expo; the platform-independence boundary between the domain layer and the Next.js/React presentation layer; API versioning and response-contract stability; the requirement that AI Agents and partner integrations consume the same APIs as web/mobile, never a parallel, undocumented path.
- **Out of Scope:** This ADR does not build any API, does not migrate any existing Server Action, does not build a mobile application, and does not implement any AI agent. It makes no change to application code, to `prisma/schema.prisma`, or to the authentication implementation. Those are all future, separately-classified and separately-approved work — this is a documentation-only architectural decision record, per explicit instruction.
- **Dependencies:** `ADR-0002-modular-monolith.md` (module boundaries and governed cross-module interfaces are the same discipline this ADR extends outward to external consumers), `ADR-0005-bilingual-architecture.md` and `ADR-0010-multilingual-architecture-expansion.md` (both fully complementary, neither superseded — language-neutrality of the domain/API layer, already required by `ADR-0005` requirement 6, is reinforced rather than altered here), `ADR-0008-ai-agent-boundaries.md` (this ADR's AI requirement is additive to, not a replacement for, ADR-0008's 17 permanent boundaries), `API_CONTRACTS.md` (owns the detailed API conventions — resource ownership, error taxonomy, Route-Handler-vs-Server-Action boundary — that this ADR elevates to a binding architectural principle), `TECH_STACK.md` (owns the still-open specific tooling decisions this ADR does not make), `SYSTEM_ARCHITECTURE.md` (Clean Architecture layering — Presentation/Application/Domain/Infrastructure — that this ADR's platform-independence requirement directly relies on).
- **Status:** Approved v1.0 — Locked upon acceptance.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## Context

BARQ's documented technology direction already implies multiple future clients: `PROJECT_MANIFEST.md`'s Long-Term Vision (§13) describes an operating system "that AI agents trust to act safely within," `BARQ_BIBLE.md`'s AI Architecture Map lists eight distinct AI Agent roles, and this project's own engineering discussion has already established that native iOS/Android applications are expected later (recorded informally before this ADR, now made binding here). None of BARQ's existing architecture documents, however, had yet stated *as a binding rule* that this multi-client future must never be paid for with duplicated business logic — the risk this ADR closes off before any mobile, AI-agent, or partner-integration code is written, not after.

The pattern this ADR exists to prevent is well understood and has a name: building web-only, discovering a mobile app is wanted, and re-implementing booking/pricing/validation rules a second time inside a mobile backend-for-frontend or, worse, inside the mobile client itself — producing two sources of truth that silently drift apart. `ADR-0002` already established the discipline of governed interfaces between internal modules ("the same discipline microservices would force via network boundaries, enforced here via code boundaries instead"); this ADR is the same discipline applied one layer outward, to every external consumer of BARQ's business capabilities, not just to modules within the monolith.

This is written now, ahead of any mobile, AI-agent-execution, or partner-integration code, following this project's own established practice of recording the constraining principle before the constrained work begins (`ADR-0002` before `SYSTEM_ARCHITECTURE.md`; `ADR-0005` before the documents it binds; `ADR-0010` before any i18n migration).

## Architecture Decision

The following become permanent architectural rules, binding on all future BARQ development:

### 1. API First
Business capabilities must be exposed through stable, versioned APIs. Future mobile applications must never depend exclusively on Next.js Server Actions. Server Actions may continue to exist for web-UI convenience — this does not deprecate their current, correct use in the Booking Engine and elsewhere — but any capability that is or will be reusable by another client must also be available through a real API, not Server-Action-only.

### 2. Shared Business Logic
Business rules exist in exactly one place. Validation, pricing, booking, availability, permissions, government support, contracts, payments, notifications, commissions, and future AI workflows all live in reusable backend modules — never duplicated separately for Web, iOS, Android, AI Agents, or partner integrations. This restates, at platform-consumer scope, the same "one place owns one truth" principle `PROJECT_MANIFEST.md` §6 already states for the Modular Monolith generally.

### 3. Mobile Ready
Future native mobile applications are expected to use React Native/Expo, unless a later ADR changes this — this ADR does not itself select or lock that framework beyond stating the current expectation. No architectural decision made from this point forward should make future native applications harder to build without duplicating logic. Authentication, uploads, pagination, notifications, offline retries, deep links, background operations, and idempotency must all be designed with mobile clients in mind, even while only a web client exists.

### 4. Platform Independence
The domain layer must remain independent from React, Next.js pages, and UI components. UI is a consumer of business logic, never its owner. This is not a new principle invented here — it restates `SYSTEM_ARCHITECTURE.md`'s existing Clean Architecture layering (Domain depends on nothing; Infrastructure implements what Domain/Application define) and the project's own existing `src/lib/<domain>/*.ts` server-module pattern already used by Booking/Services/Dashboard — this ADR makes continued adherence to that pattern binding specifically *because* multiple future clients now depend on it, not just because it's tidy.

### 5. API Versioning
Public APIs must be versioned, e.g. `/api/v1/...`. Future breaking changes create new API versions rather than mutating an existing one out from under existing clients — consistent with `API_CONTRACTS.md`'s existing Major/Minor/Deprecation versioning model and `PROJECT_RULES.md` §24's Breaking Change Policy, both restated here as binding specifically for multi-client APIs.

### 6. Stable Contracts
API response structures remain stable; validation errors use a consistent format; identifiers remain stable and avoid exposing implementation-specific database details unnecessarily. This restates `API_CONTRACTS.md`'s existing error-taxonomy and consistency requirements as binding architectural obligations, not implementation suggestions, precisely because multiple independent clients (web, iOS, Android, AI Agents, partners) will all depend on these contracts holding steady.

### 7. Future AI
AI Agents must consume the same APIs as web and mobile. AI-only business logic must never be created. This is additive to, and fully consistent with, `ADR-0008`'s existing boundary that an AI Agent never holds a direct entity-level foreign key or bypasses governed access — this ADR adds that an AI Agent also never gets its own private copy of a business rule that web/mobile also need; there is one Booking-creation rule, one pricing rule, one availability rule, consumed identically by every client type including AI.

### 8. Future Integrations
Partner systems consume documented APIs, never direct database access. This extends `ADR-0006`'s existing "no cross-module table access" discipline outward to external parties — a partner integration is architecturally treated the same way an external module would be: through a governed interface, never a backdoor into Postgres.

**Explicitly not decided by this ADR:** which specific APIs get built first, the specific mobile app's feature scope, the specific AI Agent implementations, the specific partner integrations, and any mobile authentication token mechanism's exact shape (that remains `AUTHENTICATION.md`'s and a future ADR's concern, constrained by this ADR's requirement that cookie-only auth must not be assumed as the sole mechanism).

## Out of Scope (restated for emphasis)

This ADR does not build APIs, does not migrate existing Server Actions, does not build mobile applications, and does not implement AI agents. Those are each future work, each requiring its own Architecture Change classification, plan, and approval before implementation — consistent with this project's standing engineering workflow (`PROJECT_RULES.md` §1, §4, §9) and with the equivalent discipline already recorded in `ADR-0010`'s Process Requirement for the i18n migration.

## Consequences

**Positive**
- Closes off the single most common architectural failure mode in multi-client platforms — logic forked per client — before any second client exists to fork it against.
- Gives every future feature a concrete, testable question to answer (see below) instead of a vague "keep it reusable" aspiration.
- Makes AI Agent and partner-integration work strictly additive later: they consume what already exists, rather than requiring a parallel re-implementation effort.
- Reinforces, rather than creates tension with, this project's existing Modular Monolith (`ADR-0002`) and Clean Architecture (`SYSTEM_ARCHITECTURE.md`) discipline — this is the same boundary discipline pointed outward, not a new architecture layered awkwardly on top.

**Negative / Cost**
- Every new feature must now be built with a real API surface in mind, not just a Server Action — more upfront design/implementation surface than a web-only shortcut would need.
- Mobile-readiness considerations (offline retry, idempotency, token-based auth, deep links) must be designed for now, even though no mobile client consumes them yet — a real cost paid ahead of the need materializing, deliberately, to avoid paying a larger retrofit cost later.
- Contract stability (Requirement 6) constrains how freely internal API shapes can change once any external client depends on them — a real, ongoing design discipline, not a one-time cost.

**Binding reporting requirement, going forward:** every future implementation must report, alongside its other Definition-of-Done items:
1. Is a mobile-facing API required for this capability?
2. Is any business logic coupled to the UI layer (React components, Next.js pages) rather than living in a reusable backend module?
3. Does this implementation remain API-first, or does it depend exclusively on a Server Action for a capability another client will need?
4. Can a future React Native application reuse this as-is?
5. Can a future AI Agent reuse this as-is, consistent with `ADR-0008`?

## Documentation

Per explicit instruction, this ADR's creation also updates:
- `BARQ_BIBLE.md`'s ADR Index — to list `ADR-0010` (previously omitted as a follow-up item) and `ADR-0011`.
- `docs/08-governance/DEVELOPMENT_LOG.md` — a new entry recording this ADR's creation, per `PROJECT_RULES.md` §20.2.

No application code, no `prisma/schema.prisma`, and no authentication implementation were modified by this ADR — documentation only.

---

## Related Documents
- `ADR-0002-modular-monolith.md` — the internal module-boundary discipline this ADR extends outward to external API consumers
- `ADR-0005-bilingual-architecture.md`, `ADR-0010-multilingual-architecture-expansion.md` — fully complementary, neither superseded; those govern language, this ADR governs client/consumer architecture
- `ADR-0008-ai-agent-boundaries.md` — this ADR's AI requirement (Requirement 7) is additive to, never a replacement for, its 17 permanent boundaries
- `API_CONTRACTS.md` — owns the detailed API conventions this ADR elevates to binding architectural principle; should eventually cite this ADR
- `SYSTEM_ARCHITECTURE.md` — owns the Clean Architecture layering this ADR's Platform Independence requirement (Requirement 4) relies on
- `TECH_STACK.md` — owns the still-open specific tooling decisions (mobile framework confirmation, API gateway/tooling) this ADR does not make
- `AUTHENTICATION.md` — owns the mobile-auth-mechanism decision this ADR requires but does not specify

## Open Questions
1. Exact mobile authentication token mechanism (e.g. session token vs. JWT vs. refresh-token rotation) — not decided here, deferred to `AUTHENTICATION.md` and a future ADR if it changes the current Better Auth-based approach.
2. Timing of when the first real versioned API (`/api/v1/...`) gets built, and which Bounded Context it covers first — a prioritization question deferred to `ROADMAP.md`, not decided here.
3. Whether React Native/Expo remains the confirmed mobile framework choice through to actual mobile development, or whether a dedicated ADR revisits it closer to that work — this ADR states the current expectation only, per its own Dependencies section.

## Future ADR References
- Any future ADR selecting or changing the mobile framework (React Native/Expo or otherwise) supersedes only this ADR's Requirement 3 framework expectation, not its other seven requirements.
- Any future ADR governing a specific API's design, a specific mobile app's architecture, or a specific AI Agent's implementation is additive to this ADR, constrained by it, and should cite it rather than restate its principles.
- Any change to the API-first/shared-business-logic principles themselves requires a superseding ADR, consistent with how `ADR-0010` superseded `ADR-0005`'s language-count scope while leaving its principles intact.
