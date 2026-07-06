# BARQ Technology Stack

- **Purpose:** Define BARQ's official technology stack — the single source of truth for every approved technology, framework, library, and infrastructure component. No implementation, no code, no installation guide, no tutorials — architecture decisions only.
- **Scope:** Frontend, Backend, Database, Authentication, Storage, Cache, Maps/Geolocation, Communication, AI, PDF, Observability, CI/CD, Hosting, Security Tools, and Testing stacks, plus selection principles, lifecycle, decision matrix, anti-patterns, and future evolution.
- **Out of Scope:** Implementation, code, installation commands, configuration, package manifests. Full architecture reasoning already established elsewhere (referenced, not repeated).
- **Dependencies:** `PROJECT_MANIFEST.md`, `PROJECT_RULES.md`, `ARCHITECTURE_PRINCIPLES.md`, `SYSTEM_ARCHITECTURE.md` (§9 — this document names the specific technologies that document deliberately left at category level), `DATABASE_DESIGN.md`, `API_CONTRACTS.md`, `AI_STRATEGY.md` (§4–§5, governing §11 below), `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`, `ADR-0006-database-baseline.md`, `ADR-0007-frontend-backend-hosting-stack.md`.
- **Status:** Approved v1.0 — Locked. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## 1. Executive Summary

`SYSTEM_ARCHITECTURE.md` §9 reasoned about BARQ's technology needs at the category level — a relational database, a component-based frontend, an async-capable backend runtime, managed hosting — and flagged the highest-cost choices as requiring their own dedicated ADRs before implementation. `ADR-0006` and `ADR-0007` have now closed every one of those gaps. This document is where that reasoning becomes a complete, named stack: every technology below traces back to a principle in `ARCHITECTURE_PRINCIPLES.md` or a commitment in `PROJECT_MANIFEST.md` — Cost-Aware Architecture (Principle 26) runs through nearly every choice here, since BARQ is choosing mature, well-supported, ecosystem-aligned technology over anything chosen for novelty. Nothing in this document is decided because it is popular; every choice is decided because it serves a stated principle, and every choice remains swappable behind an abstraction layer wherever vendor lock-in would otherwise compromise Principle 21 (Scalability) or Principle 22 (Fail Gracefully).

## 2. Technology Selection Principles

Every technology in this document was evaluated against all of the following before adoption — a technology failing any of these is not adopted regardless of how well it fits the others:

- **Long-Term Support:** Actively maintained with a credible multi-year outlook — not a project at risk of abandonment.
- **Production Maturity:** Proven in production at scale elsewhere, not a bleeding-edge choice for a platform handling money and trust.
- **Excellent Documentation:** Directly serves Developer Experience (`ARCHITECTURE_PRINCIPLES.md` Principle 16, Explicit over Implicit) — a poorly documented dependency creates exactly the kind of implicit, tribal-knowledge risk this project has repeatedly guarded against.
- **Large Ecosystem:** Reduces the risk of needing to build things in-house that a mature ecosystem already solves well.
- **Performance:** Consistent with Principle 13.
- **Security:** Consistent with Principle 11 — actively maintained security posture, not a dependency with a history of unresolved vulnerabilities.
- **Developer Experience:** Consistent with Principles 16–19 (Explicit over Implicit, Simplicity, Composition, Convention).
- **AI Friendliness:** Consistent with Principle 8 (AI First) — technology that is well-represented in AI training data and tooling accelerates both human and AI-assisted development on this stack, per `PROJECT_RULES.md` §20's AI-assisted engineering process.
- **Cost Awareness:** Consistent with Principle 26 — the dominant lens across this entire document.
- **Scalability:** Consistent with Principle 21 — a technology must not foreclose BARQ's GCC/international trajectory (`BUSINESS_MODEL.md` §12).
- **Maintainability:** Consistent with Principles 2, 5, 17–19 — a technology a small team can reason about and maintain confidently.

## 3. Frontend Stack

Official decisions, per `ADR-0007-frontend-backend-hosting-stack.md`:

- **Next.js** — *Purpose:* the primary frontend/backend meta-framework. *Reason:* combined frontend/backend capability serves the Modular Monolith's single-deployable philosophy (`ADR-0002`); mature RTL/i18n-compatible ecosystem serves `ADR-0005`. *Alternatives Considered:* a separate SPA framework plus a separate backend service (rejected in `ADR-0007` — reintroduces avoidable integration cost). *Trade-offs:* framework-specific conventions to learn, offset by ecosystem maturity and Vercel-native fit. *Adoption Status:* Approved.
- **React** — *Purpose:* the UI library Next.js is built on. *Reason:* the dominant component-based ecosystem, strong AI-friendliness (Principle selection criteria, §2), large talent pool. *Alternatives Considered:* other component frameworks (rejected in `ADR-0007`'s broader reasoning — no compelling reason to diverge from the Next.js-aligned choice). *Trade-offs:* client-side complexity relative to simpler server-rendered alternatives, accepted given the Operations Center's and live-tracking views' interactivity needs (`SYSTEM_ARCHITECTURE.md` §9). *Adoption Status:* Approved.
- **TypeScript** — *Purpose:* the language for both frontend and backend code. *Reason:* type safety across the frontend/backend boundary, consistent with `ADR-0007`'s reasoning and pairing directly with Prisma (`ADR-0006`). *Alternatives Considered:* plain JavaScript (rejected — conflicts with Principle 16, Explicit over Implicit, at scale). *Trade-offs:* upfront typing discipline, accepted as a correctness investment for a financial-domain platform. *Adoption Status:* Approved.
- **Tailwind CSS** — *Purpose:* utility-first styling. *Reason:* fast, consistent styling that pairs well with a design system needing strict RTL/LTR parity (`ADR-0005`) — utility classes make direction-aware styling explicit rather than implicit. *Alternatives Considered:* a traditional CSS-in-JS or component-scoped styling approach (viable, but less directly suited to the systematic RTL/LTR consistency `DESIGN_SYSTEM.md` enforces). *Trade-offs:* utility-class verbosity in markup, accepted for the consistency benefit. *Adoption Status:* Approved.
- **shadcn/ui** — *Purpose:* accessible, composable UI component foundation. *Reason:* not a locked-in component library but a copy-in pattern, avoiding the vendor-lock-in anti-pattern (§21) while still providing a strong accessibility baseline (`ARCHITECTURE_PRINCIPLES.md` Principle 14). *Alternatives Considered:* a traditional installed component library (rejected — harder to customize deeply for BARQ's premium-light, bilingual design needs without fighting the library's own opinions). *Trade-offs:* more code to own directly, accepted because it avoids exactly the kind of framework lock-in §21 forbids. *Adoption Status:* Approved.
- **React Hook Form** — *Purpose:* form state management. *Reason:* mature, performant, well-documented, pairs naturally with the validation approach below. *Alternatives Considered:* uncontrolled/manual form handling (rejected — reinvents a well-solved problem, conflicting with Principle 18, Composition over Duplication). *Trade-offs:* negligible at this stage. *Adoption Status:* Approved.
- **Zod** — *Purpose:* schema validation, shared conceptually between frontend form validation and backend input validation (`API_CONTRACTS.md` §7's Validation error category). *Reason:* TypeScript-native, single validation definition reducing duplicated validation logic between client and server (Principle 18). *Alternatives Considered:* separate, unrelated validation libraries per layer (rejected — the duplication risk is exactly what Zod's shared-schema approach avoids). *Trade-offs:* negligible. *Adoption Status:* Approved.
- **TanStack Query** — *Purpose:* client-side data-fetching/caching state management. *Reason:* mature, well-documented solution for a problem Next.js's own data-fetching primitives don't fully solve on the client. *Alternatives Considered:* manual fetch/state management (higher duplication risk). *Trade-offs:* an additional dependency to evaluate for real necessity given Next.js Server Actions/Route Handlers may cover some of the same need. *Adoption Status:* **Future Evaluation** — not yet Approved; to be revisited once real client-side data-fetching complexity is observed, not adopted speculatively (Cost-Aware Architecture, §2).

## 4. Backend Stack

Official decisions, per `ADR-0007`:

- **Next.js Route Handlers** — *Purpose:* the primary mechanism for BARQ's Public/Internal/Admin/Operations/Provider/AI API categories (`API_CONTRACTS.md` §3). *Reason:* co-located with the frontend in the same Modular Monolith deployable, consistent with `ADR-0002`. *Adoption Status:* Approved.
- **Server Actions** — *Purpose:* used for tightly-coupled UI-to-backend mutations where a full API contract isn't the right shape (e.g. simple form submissions internal to a single Presentation Layer flow). *Reason:* reduces boilerplate for cases that don't need the full versioned-contract discipline `API_CONTRACTS.md` requires for real API resources. *Important boundary:* Server Actions are never used as a way to bypass `API_CONTRACTS.md`'s standards for anything that is genuinely a cross-client API resource (§21 anti-pattern: never bypass approved stack conventions) — they are reserved for genuinely UI-internal mutations only. *Adoption Status:* Approved, with this explicit boundary stated to prevent scope creep into API-contract territory.
- **TypeScript** — Shared with Frontend (§3); not restated.
- **Node.js LTS** — *Purpose:* the runtime Next.js's backend capability runs on. *Reason:* per `ADR-0007` — strong async I/O support relevant to Notifications and Tracking modules (`SYSTEM_ARCHITECTURE.md` §5). *Adoption Status:* Approved; always the current LTS release per §18's Upgrade Policy, never an End-of-Life version.

## 5. Database Stack

Fully governed by `ADR-0006-database-baseline.md` — referenced, not restated, per Single Source of Truth:

- **PostgreSQL** — primary database. Approved (`ADR-0006`).
- **Prisma** — ORM. Approved (`ADR-0006`).
- **Migration Strategy** — Prisma's native migration tooling, used consistently with `PROJECT_RULES.md` §24 (Breaking Change Policy) for any backward-incompatible schema change.
- **Connection Pooling** — required given Vercel's serverless/edge execution model (`ADR-0007`) — a pooling layer between the application and PostgreSQL is a necessary architectural component, not optional, in this hosting context. Specific pooling technology/configuration is an implementation detail, not fixed in this document.
- **UUID v7** — primary key strategy. Approved (`ADR-0006`).

## 6. Authentication Stack

**Resolved by `AUTHENTICATION.md`** — Better Auth is confirmed as BARQ's authentication technology, decided once that document fully specified the OTP and Staff-Assisted Booking flow requirements this section originally deferred to:

- **Better Auth (Approved)** — *Reason:* TypeScript-native, self-hosted, and capable of supporting BARQ's genuinely custom OTP/Staff-Assisted Booking flow without a third-party auth-as-a-service constraint, consistent with `SYSTEM_ARCHITECTURE.md` §9's original Authentication reasoning.
- **Alternative: NextAuth** — remains the documented fallback if Better Auth's custom-flow support proves insufficient during implementation, per `AUTHENTICATION.md` §4.
- **Adoption Status:** Approved. No ADR required — Authentication was not among the three items `SYSTEM_ARCHITECTURE.md` §9 flagged as High Reversal Cost (Frontend, Backend, Hosting), consistent with the governance rule established when this document was Locked (Technology Decision Matrix sufficient for non-High-Reversal-Cost choices).

## 7. Storage Stack

- **Object Storage, S3-Compatible** — *Purpose:* stores Invoice/Contract PDFs and any future media. *Reason:* per `ADR-0006`'s File Storage decision and `SYSTEM_ARCHITECTURE.md` §9 — scales without rework, low cost even at small scale. *Adoption Status:* Approved, at the category level (S3-compatible); specific provider selection is left open as it is a comparatively low-reversal-cost, abstraction-layer-protected choice (§21 — never lock business logic to vendor APIs).
- **Metadata inside PostgreSQL only** — per `ADR-0006` and `DATABASE_DESIGN.md` §18's explicit anti-pattern against storing files inside PostgreSQL — files live in Object Storage; only their metadata (location reference, filename, type) lives in the database. Approved.

## 8. Cache

- **Redis** — *Purpose:* caching, session storage support, rate-limiting support (`API_CONTRACTS.md` §15), and a future queue backend. *Reason:* mature, widely adopted, satisfies every criterion in §2. *Caching Philosophy:* applied only to read-heavy, slow-changing data, per `SYSTEM_ARCHITECTURE.md` §6/§10 and `DATABASE_DESIGN.md` §12 — never for Wallet balance, Availability state, or any live-correctness-required data; a cache failure must degrade performance, never correctness. *Session Storage:* a candidate use, pending `AUTHENTICATION.md`'s actual session-strategy decision (§6). *Rate Limiting Support:* Redis's atomic counters are a natural fit for `API_CONTRACTS.md` §15's per-category rate limits. *Future Queues:* Redis-backed queueing is a plausible future mechanism for `SYSTEM_ARCHITECTURE.md` §7's Background Jobs (PDF generation, Notification dispatch) — not committed as the final queue technology, flagged as a future direction. *Adoption Status:* Approved for caching/rate-limiting; session storage and queue usage remain contingent on other not-yet-written documents.

## 9. Maps & Geolocation

- **Google Maps Platform** — *Reason:* per `SYSTEM_ARCHITECTURE.md` §9's original reasoning — strong regional coverage in Oman/GCC, which a like-for-like open-data alternative carries real accuracy risk on for this specific region. *Alternatives:* an open-data mapping alternative (weaker regional accuracy risk, as already reasoned in `SYSTEM_ARCHITECTURE.md` §9). *Future Abstraction Layer:* accessed exclusively through the Integration Layer (`SYSTEM_ARCHITECTURE.md` §4), so a future provider switch — if GCC/international expansion ever surfaces a better-suited regional provider — doesn't ripple into the Tracking module's domain logic, per §21's anti-pattern against vendor lock-in. *Adoption Status:* Approved, with the abstraction boundary treated as non-negotiable, not optional.

## 10. Communication

- **WhatsApp Business API** — *Purpose:* the primary Notifications channel. *Reason:* per `SYSTEM_ARCHITECTURE.md` §9's original reasoning — highest-reach channel for Oman/GCC. Accessed through the Integration Layer, with the fallback-channel requirement already established (`ARCHITECTURE_PRINCIPLES.md` Principle 22). *Adoption Status:* Approved.
- **Email Provider Abstraction** — *Purpose:* a defined abstraction layer over whichever email provider is eventually chosen, rather than direct coupling. *Reason:* consistent with §21's anti-pattern against vendor lock-in — email is a plausible fallback/secondary channel and its specific provider is a lower-cost, swappable decision. *Adoption Status:* Approved at the abstraction-layer level; specific provider not yet selected (§23).
- **SMS Abstraction** — Same reasoning as Email — an abstraction layer over the eventual OTP/SMS delivery provider already referenced in `SYSTEM_ARCHITECTURE.md` §9's Authentication reasoning. *Adoption Status:* Approved at the abstraction-layer level; specific provider not yet selected (§23).
- **Future Push Notifications** — Not part of V1 (native apps are Out of MVP per `PRODUCT_REQUIREMENTS.md` §6); flagged for future evolution (§22) once native apps are built.

## 11. AI Stack

- **LLM Gateway / Provider Abstraction** — *Purpose:* a single internal boundary through which every AI Agent role (`AI_STRATEGY.md` §3) accesses language model capability, rather than any module calling a specific vendor's API directly. *Reason:* directly satisfies `AI_STRATEGY.md` §5 (Knowledge Sources) and `SYSTEM_ARCHITECTURE.md` §9's original reasoning that the AI provider must remain swappable without a domain-level rewrite — this is not optional infrastructure, it's the mechanism that makes `AI_STRATEGY.md` §4's boundaries enforceable regardless of which underlying model answers a given request.
- **OpenAI, Claude** — *Purpose:* candidate LLM providers accessed through the Gateway above. *Reason:* both are production-mature, well-documented, and satisfy §2's selection principles; maintaining two rather than one from day one directly demonstrates that the abstraction layer is real, not theoretical. *Adoption Status:* Approved as candidate providers behind the Gateway; the Gateway abstraction itself is the actual architectural commitment, not a permanent preference for either specific vendor.
- **Prompt Engine** — *Purpose:* the implementation of `AI_STRATEGY.md` §7's Prompt Governance (versioning, review, lifecycle) — not a specific named product in this document, since the requirement is behavioral (versioned, reviewed, retireable prompts) rather than tied to one particular tool. *Adoption Status:* Approved at the requirement level; specific tooling deferred (§23).
- **Future Local Models** — Not part of V1; self-hosting models was already rejected at the category level in `SYSTEM_ARCHITECTURE.md` §9 as premature infrastructure cost. Flagged as a future evolution path (§22) only if data-residency or cost dynamics change materially.
- **Future MCP** (Model Context Protocol) — a candidate future mechanism for structured AI-to-tool interaction, consistent with keeping AI Agent actions governed and auditable (`AI_STRATEGY.md` §4) rather than ad hoc. Not committed for V1.
- **Future RAG** (Retrieval-Augmented Generation) — a candidate future mechanism directly serving `AI_STRATEGY.md` §5's "AI Learns From Approved Knowledge Only" principle, if/when a formal Knowledge Base and Vector Store (`DATABASE_DESIGN.md` §13, §19) are adopted. Not committed for V1.

**Why AI vendors are abstracted:** Per `AI_STRATEGY.md` §5, AI Agents may only learn from approved knowledge sources — and per `SYSTEM_ARCHITECTURE.md` §9, the specific LLM vendor is explicitly not meant to be a permanent architectural commitment. Abstracting the vendor behind a Gateway means a future change in model quality, pricing, or availability from any one provider never requires touching `AI_STRATEGY.md`'s governance logic, the AI Layer's module boundaries (`SYSTEM_ARCHITECTURE.md` §4–§5), or any Bounded Context's domain logic — the abstraction is what makes AI Boundaries (`AI_STRATEGY.md` §4) enforceable independent of vendor, not merely a cost-hedging convenience.

## 12. PDF Stack

- **React PDF** — *Purpose:* server-side generation of Invoice and Contract PDFs (`SYSTEM_ARCHITECTURE.md` §9's Invoicing/Contracts reasoning). *Reason:* keeps bilingual formatting (`ADR-0005`) and legal numbering requirements (`DOMAIN_MODEL.md` Invoice/Contract invariants) under direct component-based control, consistent with the existing React/TypeScript stack (§3) rather than introducing an unrelated templating technology. *Alternatives Considered:* a third-party PDF-generation API (already rejected in `SYSTEM_ARCHITECTURE.md` §9 for the same Invoicing/Contracts reasoning — more ongoing cost and less control over bilingual legal formatting). *Adoption Status:* Approved.

## 13. Observability

- **Sentry** — *Purpose:* error tracking and APM, satisfying `ARCHITECTURE_PRINCIPLES.md` Principle 20 (Observability by Design) without building custom tooling, consistent with `SYSTEM_ARCHITECTURE.md` §9's original Monitoring reasoning (managed, Cost-Aware). *Adoption Status:* Approved.
- **Structured Logging** — *Purpose:* preserves the Activity Log/Audit Log distinction (`DATABASE_DESIGN.md` §9) at the application-logging level, consistent with `SYSTEM_ARCHITECTURE.md` §9's Logging reasoning. Specific logging library is an implementation detail, not fixed here. *Adoption Status:* Approved at the requirement level.
- **Future OpenTelemetry** — a candidate future standard for distributed tracing (`API_CONTRACTS.md` §16's Trace IDs) if/when cross-service tracing needs grow beyond what Sentry's APM covers alone. Not committed for V1.

## 14. CI/CD

- **GitHub** — *Purpose:* source control host. *Reason:* satisfies every §2 criterion; pairs naturally with GitHub Actions below.
- **GitHub Actions** — *Purpose:* CI/CD pipeline, enforcing the branch/review discipline already established in `PROJECT_RULES.md` §11–§14 automatically rather than relying on manual compliance, consistent with `SYSTEM_ARCHITECTURE.md` §9's original CI/CD reasoning.
- **Branch Strategy** — Governed entirely by `PROJECT_RULES.md` §12 — referenced, not restated.
- **Deployment Strategy** — Continuous deployment from `main` to Production for approved, tested changes, consistent with Vercel's native Git-integrated deployment model (`ADR-0007`) — exact promotion gates (e.g. required approvals before production deploy) are a Quality Gates decision, immediately below.
- **Quality Gates** — Automated tests (§17) and Code Review (`PROJECT_RULES.md` §14) must pass before any merge to `main`; the §11.2 temporary documentation-phase exception in `PROJECT_RULES.md` remains the only current exception to full branch/PR discipline, and closes automatically once implementation begins, per that document's own terms.

## 15. Hosting

Fully governed by `ADR-0007-frontend-backend-hosting-stack.md` — referenced, not restated:

- **Development, Production (initially):** Vercel. Approved (`ADR-0007`).
- **Future Docker:** A candidate future containerization step if a module is ever extracted per `SYSTEM_ARCHITECTURE.md` §11's extraction strategy, or if migrating off Vercel is ever warranted (`ADR-0007`'s stated cost trade-off). Not committed for V1.
- **Future Kubernetes:** A candidate future orchestration layer only if/when module extraction (`SYSTEM_ARCHITECTURE.md` §5, §11) produces enough independently-deployed services to justify the operational complexity — explicitly not adopted prematurely, per Cost-Aware Architecture.
- **Future Multi-Region:** Per `SYSTEM_ARCHITECTURE.md` §14 — not a V1 commitment; flagged as compatible with, not precluded by, the current hosting choice.

## 16. Security Tools

- **Secrets:** Managed via the hosting platform's (Vercel's) environment/secret management, per `PROJECT_RULES.md` §16 and `SYSTEM_ARCHITECTURE.md` §12 — never committed to any repository, ever.
- **Environment Variables:** Used for environment-specific configuration (`SYSTEM_ARCHITECTURE.md` §6's Configuration cross-cutting concern) — never used to store a secret in a way that ends up logged or exposed client-side by accident; that distinction is a binding rule, not a suggestion.
- **Dependency Scanning:** Automated scanning integrated into the CI/CD pipeline (§14), consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 11 (Security by Design) — specific tooling is an implementation detail, not fixed here.
- **Security Updates:** Governed by §18's Upgrade Policy — security patches are never deferred past a routine upgrade cycle; a security-relevant dependency update is treated with higher urgency than a routine version bump.

## 17. Testing Stack

- **Vitest** — *Purpose:* unit and integration testing. *Reason:* fast, TypeScript-native, pairs naturally with the Next.js/TypeScript stack (§3–§4), satisfying `PROJECT_RULES.md` §15's binding minimum on automated test coverage — especially for the highest-risk domains (Wallet, Booking, Pricing, Authentication). *Adoption Status:* Approved.
- **Playwright** — *Purpose:* end-to-end testing, including bilingual/RTL-LTR verification (`ADR-0005`, `PRODUCT_REQUIREMENTS.md` §8's Accessibility NFR) across real user flows. *Reason:* mature, well-documented, capable of testing both languages/directions as part of the same E2E suite. *Adoption Status:* Approved.
- **Future Load Testing:** Not part of V1's minimum; a candidate addition once real traffic patterns are known well enough to test against meaningfully, rather than testing against a guess.
- **Future Security Testing:** A candidate future addition (e.g. automated penetration testing) once `SECURITY.md`'s full security testing requirement is implemented in tooling.

## 18. Upgrade Policy

- **LTS Versions:** Node.js and any other technology offering a Long-Term Support track always runs on the current LTS release, never an End-of-Life version, consistent with §2's Long-Term Support selection criterion.
- **Dependency Updates:** Routine, scheduled dependency updates, distinct from and faster-tracked than major version upgrades (below) — keeping dependencies current is treated as ongoing maintenance, not a deferred, occasional cleanup task.
- **Major Version Policy:** A major version upgrade of any stack component in this document is evaluated against §2's criteria again before adoption — a major version isn't auto-adopted just because it's available; it's treated with the same rigor as an initial adoption decision.
- **Deprecation Policy:** When a technology in this document is marked Deprecated (§19), a replacement path is identified before deprecation is finalized — BARQ does not deprecate a dependency into a gap with nothing to replace it.

## 19. Technology Lifecycle

Every technology in this document sits in exactly one of these states at any time:

- **Proposed:** Under evaluation against §2's criteria; not yet used in any real implementation (e.g. Authentication Stack, §6).
- **Approved:** Meets §2's criteria and is authorized for use (the default status for most entries above).
- **Experimental:** Approved for limited, clearly-bounded use (e.g. a specific module or a proof-of-concept) while its fit is being validated — not yet trusted platform-wide.
- **Deprecated:** Still in use but scheduled for replacement, per §18's Deprecation Policy — new code should not adopt a Deprecated technology for new work.
- **Retired:** No longer in use anywhere in BARQ's codebase; kept in this document's history for context, not as a current option.

## 20. Technology Decision Matrix

| Technology | Status | Owner | ADR | Review Frequency | Replacement Cost | Risk Level |
|---|---|---|---|---|---|---|
| Next.js / React / TypeScript | Approved | CTO/Principal Architect | `ADR-0007` | Annual | High | Low (mature, widely adopted) |
| Node.js LTS | Approved | CTO/Principal Architect | `ADR-0007` | Per LTS cycle | High | Low |
| Tailwind CSS | Approved | Principal Architect | — | Annual | Medium | Low |
| shadcn/ui | Approved | Principal Architect | — | Annual | Low (copy-in pattern) | Low |
| React Hook Form | Approved | Principal Architect | — | Annual | Low | Low |
| Zod | Approved | Principal Architect | — | Annual | Low | Low |
| TanStack Query | **Future Evaluation** | Principal Architect | — | At evaluation | Low | N/A (not yet adopted) |
| PostgreSQL | Approved | CTO/Principal Architect | `ADR-0006` | Annual | High | Low |
| Prisma | Approved | CTO/Principal Architect | `ADR-0006` | Annual | Medium-High | Low-Medium |
| Better Auth / NextAuth | **Proposed** | CTO/AI Architect | Pending `AUTHENTICATION.md` | At decision | Medium | Medium (undecided) |
| Object Storage (S3-Compatible) | Approved (category) | Principal Architect | — | Annual | Low (abstracted) | Low |
| Redis | Approved | Principal Architect | — | Annual | Medium | Low |
| Google Maps Platform | Approved | Principal Architect | — | Annual | Medium (abstracted) | Low-Medium |
| WhatsApp Business API | Approved | Product Manager/Principal Architect | — | Annual | Medium | Medium (template approval dependency) |
| Email/SMS Abstraction | Approved (layer); provider TBD | Principal Architect | — | At provider selection | Low (abstracted) | Low |
| LLM Gateway (OpenAI, Claude) | Approved | AI Architect | — | Quarterly (fast-moving space) | Low (abstracted) | Medium (vendor/model volatility) |
| React PDF | Approved | Principal Architect | — | Annual | Low-Medium | Low |
| Sentry | Approved | Principal Architect | — | Annual | Medium | Low |
| GitHub / GitHub Actions | Approved | CTO | — | Annual | Medium | Low |
| Vercel | Approved | CTO/Principal Architect | `ADR-0007` | Annual | High | Low-Medium (platform affinity, per `ADR-0007`) |
| Vitest / Playwright | Approved | Principal Architect | — | Annual | Low-Medium | Low |

## 21. Anti-Patterns

Explicitly forbidden, without exception:

- Never choose technology because of hype — every entry above traces to §2's criteria, not trend-following.
- Never bypass the approved stack — a module reaching for an unapproved library because it's convenient in the moment violates this document's authority as the single source of truth for approved technology.
- Never duplicate libraries — two libraries solving the same problem (e.g. two form-state libraries) is a Principle 18 (Composition over Duplication) violation at the dependency level.
- Never introduce new frameworks without an ADR — consistent with `PROJECT_RULES.md` §4's ADR process applied specifically to technology adoption.
- Never mix UI systems — shadcn/ui (§3) is the approved component foundation; introducing a second, competing component library fragments the Design System before it's even written.
- Never access the database outside Prisma — consistent with `ADR-0006` and `DATABASE_DESIGN.md` §18's anti-pattern list; a raw SQL escape hatch used casually undermines the type-safety rationale Prisma was chosen for.
- Never lock business logic to vendor APIs — the abstraction layers in §9–§11 (Maps, Communication, AI) exist specifically to prevent this; a module calling a vendor SDK directly from Domain Layer code violates `SYSTEM_ARCHITECTURE.md` §4's layering as much as it violates this document.

## 22. Future Evolution

- **Edge Computing:** A candidate future optimization for latency-sensitive paths (Live Tracking, per `ARCHITECTURE_PRINCIPLES.md` Principle 13), compatible with but not committed to by the current Vercel-based hosting choice.
- **Offline Support:** Explicitly Out of MVP (`PRODUCT_REQUIREMENTS.md` §6) — a future consideration once native apps (also Out of MVP) are eventually built.
- **AI Models:** Per §11 — Future Local Models, MCP, and RAG all remain directional, not committed.
- **Mobile Apps:** Native iOS/Android apps, per `PRODUCT_REQUIREMENTS.md` §6/§12 — a V2/V3 candidate, not V1.
- **Microservices:** Only via the module-by-module extraction strategy already defined in `SYSTEM_ARCHITECTURE.md` §5/§11 — never a wholesale architecture change, and never adopted merely because it's available.
- **Regional Expansion:** Per `BUSINESS_MODEL.md` §12 and `DATABASE_DESIGN.md` §8 — the current stack (Vercel, PostgreSQL) is chosen partly because it does not preclude this, not because regional expansion is being built now.

## 23. Open Decisions

Intentionally deferred — not invented here:

1. **Final Authentication technology** (Better Auth vs. NextAuth, §6) — deferred to `AUTHENTICATION.md`.
2. **Specific S3-compatible Object Storage provider** (§7) — category approved, specific vendor not yet selected.
3. **Specific Email and SMS providers** (§10) — abstraction layer approved, providers not yet selected.
4. **Specific Prompt Engine tooling** (§11) — requirement approved, specific tool not yet selected.
5. **Connection pooling technology/configuration** (§5) — requirement identified as necessary given Vercel's execution model; specific implementation not decided here.
6. **Dependency scanning tool** (§16) — requirement approved, specific tool not yet selected.
7. **Timing of Future Evaluation items** (TanStack Query, OpenTelemetry, Load/Security Testing, Local Models, MCP, RAG) — no adoption timeline committed for any of them.

---

## Related Documents
- `PROJECT_MANIFEST.md`, `PROJECT_RULES.md` — foundational philosophy and process, especially §20 (AI-assisted engineering) and §4 (ADR process, per §21's technology-adoption anti-pattern)
- `ARCHITECTURE_PRINCIPLES.md` — the direct source of every criterion in §2
- `SYSTEM_ARCHITECTURE.md` — §9, the category-level reasoning this document names specific technology for
- `DATABASE_DESIGN.md` — §11, §12, §18 — security, performance, and anti-pattern requirements this document's stack must satisfy
- `API_CONTRACTS.md` — §15, §16 — rate-limiting and observability requirements informing §8, §13
- `AI_STRATEGY.md` — §4–§5, §7 — governing §11 in full
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`, `ADR-0006-database-baseline.md`, `ADR-0007-frontend-backend-hosting-stack.md` — the architectural decisions this entire document is built on
- `AUTHENTICATION.md`, `DESIGN_SYSTEM.md`, `SECURITY.md` — each has been checked for consistency with this document as of its own creation; no conflict found

## Open Questions
1. §11's dual-provider approach (OpenAI, Claude) — should BARQ commit to one as primary with the other as fallback, or keep genuine dynamic routing between them? Not decided here; a question for whoever owns AI Layer implementation once that work begins.

**Resolved at Architecture Review:** The Technology Decision Matrix (§20) is confirmed as sufficient governance for low- and medium-risk technology choices; ADRs are reserved for High Reversal Cost decisions only, not every library. This is now a binding governance rule for all future entries added to §20, not merely a precedent from this document.

## Future ADR References
- Any technology whose Status in §20 is Proposed or Future Evaluation, once actually adopted, requires either an ADR (if High Reversal Cost) or a Technology Decision Matrix update with recorded reasoning (if not) — never a silent adoption.
- Any move from the current Vercel-based hosting to Docker/Kubernetes (§15, §22) requires an ADR, per `ADR-0007`'s own Future ADR Reference.
