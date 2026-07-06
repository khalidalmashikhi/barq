# BARQ API Contracts

- **Purpose:** Define BARQ's API architecture — the single source of truth for every public and internal API contract's *shape and rules*, not its implementation. No endpoints, no OpenAPI, no JSON examples, no code.
- **Scope:** API philosophy, API categories, resource ownership philosophy, request/response standards, error model, versioning strategy, authentication/authorization expectations (by reference), event and webhook contracts, AI API principles, performance, security, observability, and future evolution — all at the architecture level.
- **Out of Scope:** Specific endpoints, request/response payload examples, OpenAPI/schema definitions, framework-specific detail, implementation of any kind. Full authentication/authorization mechanics (owned by `AUTHENTICATION.md`/`IDENTITY_AND_ACCESS.md`, referenced not redefined per §9–§10).
- **Dependencies:** `PROJECT_MANIFEST.md`, `PROJECT_RULES.md`, `ARCHITECTURE_PRINCIPLES.md` (Principle 7, API First; Principle 8, AI First), `DOMAIN_MODEL.md` (§4's resource ownership maps to its Bounded Contexts/entities exactly), `BUSINESS_MODEL.md`, `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md` (§4–§8, the layering and module boundaries every API sits in front of), `DATABASE_DESIGN.md` (§6–§7, cross-context reference rules and localization strategy this document's request/response standards must respect), `AI_STRATEGY.md` (§3–§4, governing §13 in full), `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`, `ADR-0006-database-baseline.md` (Money/Currency and UTC time conventions carried through to §5).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## A Note on Two Previously Referenced Documents

Sections 9 and 10 were originally written when `AUTHENTICATION.md` and `IDENTITY_AND_ACCESS.md` did not yet exist. Both now exist and are Locked. §9 and §10 below were written to state only API-level *expectations*, deliberately without inventing mechanics — that content remains accurate and does not require revision. This note is retained to record that the two documents have since been written; the cross-check flagged in the original Open Question #1 is still a separate, deliberate action, not performed automatically by their existence.

---

## 1. Executive Summary

BARQ's APIs are the contract every consumer — the Customer Web App, Provider Portal, Operations Center, Admin Dashboard, AI Layer, and eventually external partners — depends on, per `ARCHITECTURE_PRINCIPLES.md` Principle 7 (API First). Every API is designed before its consumer, shaped around the Bounded Contexts already defined in `DOMAIN_MODEL.md`, never around whatever a specific screen happened to need first. Contracts are stable, explicitly versioned, bilingual-aware at the negotiation layer (never at the business-logic layer, per `ADR-0005`), and treat the AI Layer as just another governed consumer subject to the same authorization boundary as any human-driven client (`SYSTEM_ARCHITECTURE.md` §6, §12). This document defines the rules every future API must follow; it does not itself define a single endpoint.

## 2. API Philosophy

- **API First:** Per Principle 7 — contracts exist before implementation and before the UI that consumes them.
- **Stable Contracts:** A published contract is a promise; changing it without versioning (§8) breaks that promise and every consumer depending on it.
- **Backward Compatibility:** Preferred over breaking change wherever feasible — a new capability is additive by default, not a forced migration.
- **Explicit Versioning:** No silent, undocumented contract change, ever — §8 governs this in full.
- **Consistency:** The same resource-naming, pagination, error, and response conventions apply across every API category (§3) — a consumer learning one part of the API should be able to predict the shape of another.
- **Security:** Every request is authenticated and authorized before it reaches business logic (`SYSTEM_ARCHITECTURE.md` §6, §12) — the API layer is a real enforcement boundary, not a thin pass-through that trusts the caller.
- **Performance:** API design decisions (pagination, payload shape) are made with the Mobile First constraint (`ARCHITECTURE_PRINCIPLES.md` Principle 9) in mind by default, not as a later optimization pass.
- **Bilingual Friendly:** Every API that returns human-readable content supports Arabic/English negotiation per `ADR-0005` — this is a contract-level requirement, not a client-side afterthought.
- **AI Ready:** APIs are designed to be consumed by AI Agents as naturally as by human-driven clients (Principle 8), through the same governed interfaces — never a separate, looser contract "for AI convenience."

## 3. API Categories

- **Public API:** Consumed by the Customer Web App — the least privileged, most heavily rate-limited and validated category, since it faces the open internet.
- **Internal API:** Consumed by other BARQ modules/services within the Modular Monolith's own boundaries (`SYSTEM_ARCHITECTURE.md` §7's communication patterns) — not exposed externally.
- **Admin API:** Consumed by the Admin Dashboard — highest-privilege category, every call subject to Audit Logging per `DATABASE_DESIGN.md` §9.
- **Operations API:** Consumed by the Operations Center — real-time-oriented, read-heavy, with the specific performance profile `SYSTEM_ARCHITECTURE.md` §5 already flagged for that module.
- **Provider API:** Consumed by the Provider Portal — scoped strictly to a given Provider's own data (Availability, Wallet, Services/Experiences), never another Provider's.
- **AI API:** Consumed by the AI Layer (`SYSTEM_ARCHITECTURE.md` §4–§5) — governed entirely by §13 below and `AI_STRATEGY.md` §4's absolute boundaries.
- **Webhook API:** Outbound notifications to external systems — governed by §12.
- **Future Partner API:** Not part of V1 (`PRODUCT_REQUIREMENTS.md` §6, Out of MVP) — named here only so future partner-facing work has a defined category to grow into, not because it's being built now.

## 4. Resource Design

**Resource philosophy:** Every API resource corresponds to exactly one Bounded Context's owned entity, per `DOMAIN_MODEL.md` — a resource is never invented at the API layer independent of the domain model, and an API never exposes a shape that implies ownership a Bounded Context doesn't actually have (per `DATABASE_DESIGN.md` §4's ownership table, carried forward here at the API layer). No endpoints are defined in this document — only which context owns which resource, so future endpoint design has an unambiguous starting point.

- **Customers** — owned by Customer context.
- **Providers** (including Drivers, Guides, Vehicles, Assets, Services, Experiences) — owned by Provider context.
- **Bookings** — owned by Booking context.
- **Vehicles** — owned by Provider context (a specialization of Assets, per `DOMAIN_MODEL.md`), not a separate top-level ownership.
- **Services** (including Experiences) — owned by Provider context.
- **Journeys** and **Tracking** data — owned by Tracking context, distinct from Bookings per the same split already established in `DOMAIN_MODEL.md` and `SYSTEM_ARCHITECTURE.md` §5.
- **Wallets** — owned by Wallet context.
- **Invoices** — owned by Invoicing context.
- **Contracts** — owned by Contracts context.
- **Notifications** — owned by Notifications context.
- **Reviews** — owned by Reviews context.
- **Support** — owned by Operations context (Support Ticket), consistent with the fold-in decision already recorded in `SYSTEM_ARCHITECTURE.md` §5's own note on this same naming discrepancy — not reintroduced as a separate resource ownership question here.
- **Administration** — owned by Administration context.
- **AI** — owned by AI context, exposed only through the AI API category (§3), never as a generic resource other categories can query directly.

A resource never spans two Bounded Contexts' ownership — where a client needs data from two contexts (e.g. a Booking with its Provider's display name), that composition happens at the API layer through the same cross-context reference rule already established in `DATABASE_DESIGN.md` §6 (ID reference, or a deliberate read-model), never by an API resource silently merging two contexts' owned data into one ambiguous shape.

## 5. Request Standards

- **Identifiers:** UUID v7, per `ADR-0006` — carried through from the data layer to the API layer without translation, so an internal ID and an API-facing ID are the same value (see §18 on why this is still not the same thing as *exposing* implementation detail — an opaque, stable identifier is not a schema leak).
- **Pagination:** Default and mandatory for every list-returning request, per `SYSTEM_ARCHITECTURE.md` §10 — never an unbounded list response.
- **Filtering / Sorting / Searching:** Consistent parameter conventions across every resource category — exact parameter names are an implementation-level decision, not fixed in this document, but the requirement for consistency across resources is.
- **Date Formats:** All API-facing dates/times are UTC, per `ADR-0006` — client-side local-time conversion is a presentation concern, never an API contract concern.
- **Money Formats:** Always an (Amount, Currency) pair, per `ADR-0006` — never a bare number, consistent with the data layer all the way through to the API surface.
- **Language Negotiation:** Every request that returns human-readable content negotiates Arabic/English per `ADR-0005`. **Resolved by `LOCALIZATION.md` §3**, the authoritative source for this decision: an authenticated user's stored preference, then request-level negotiation, then Arabic default — this section no longer treats the mechanism as open.
- **Idempotency:** Required for every state-changing request with financial or booking consequence (Booking confirmation, Payment capture) — a repeated request with the same idempotency key must not double-charge or double-confirm, directly protecting the invariants already established in `DOMAIN_MODEL.md` for `Booking` and `Payment`.
- **Correlation IDs:** Every request carries a correlation ID propagated through to Activity/Audit Logs (`DATABASE_DESIGN.md` §9) and observability tooling (§16) — so a single user action is traceable end-to-end across module boundaries.

## 6. Response Standards

- **Success:** A consistent envelope shape across every API category — exact structure is implementation detail, but consistency itself is the contract-level requirement.
- **Errors:** Governed in full by §7 — never an ad hoc, per-endpoint error shape.
- **Warnings:** A defined channel for non-fatal issues (e.g. "Notification queued but delivery not yet confirmed") distinct from hard Errors — so a client can distinguish "this failed" from "this succeeded with a caveat."
- **Metadata:** Pagination cursors, request correlation ID (§5), and API version (§8) travel consistently with every response, not just some.
- **Pagination:** Response-side cursor/page metadata consistent with the request-side convention in §5.
- **Localization:** Every localized field in a response is unambiguous about which language it's in — never a response that mixes languages within one field or leaves language ambiguous.
- **AI Responses:** Governed in full by §13 — an AI-generated response is never shaped identically to a plain data response without some indication it's AI-originated, consistent with `AI_STRATEGY.md` §2's Transparent Automation principle applied at the API contract level.

## 7. Error Model

- **Validation:** Malformed or missing request data — caught before Domain Layer logic executes, per `SYSTEM_ARCHITECTURE.md` §6.
- **Authorization:** The caller is authenticated but not permitted to perform the requested action — distinct from Authentication errors below.
- **Authentication:** The caller's identity could not be established or verified — distinct from Authorization; conflating the two leaks information about which failure occurred (see §18, never leak business rules — the same principle applies to error specificity for security-sensitive failures).
- **Business Rule:** The request is well-formed and authorized, but violates a domain invariant (`DOMAIN_MODEL.md`) — e.g. attempting to book an unavailable slot.
- **Rate Limit:** The caller has exceeded an allowed request rate (§15).
- **Infrastructure:** A failure in a dependency (§14, §13's Integration Layer per `SYSTEM_ARCHITECTURE.md` §13) rather than the request itself.
- **AI:** A distinct category for AI-specific failure modes (low confidence, knowledge gap, escalation triggered per `AI_STRATEGY.md` §8) — never silently folded into a generic error, since an AI failure often has a different correct client response (e.g. "ask a human") than a validation failure does.

Every error category returns enough information for a legitimate client to act correctly, and never enough to leak internal structure — this tension is resolved explicitly in §18, not left to individual judgment per error.

## 8. Versioning Strategy

- **Major:** A breaking change to a contract — requires the full Breaking Change Policy already established in `PROJECT_RULES.md` §24 (governing ADR, documented migration path) before it ships.
- **Minor:** An additive, backward-compatible change (new optional field, new endpoint) — does not require a new major version.
- **Deprecation:** A version or field is marked deprecated with a stated timeline before removal — never removed without a prior deprecation notice period.
- **Sunset Policy:** A deprecated version has a defined end-of-life date, communicated to consumers in advance; exact duration is an Open Decision (§19), not invented here.
- **Compatibility:** Within a major version, only additive changes are permitted — this is what makes Minor versioning meaningful as a distinct, lower-risk category from Major.

## 9. Authentication Strategy

Full mechanics are owned entirely by `AUTHENTICATION.md` — referenced here, not redefined. API-level expectations only:

- Every API request (except explicitly public, unauthenticated endpoints, if any are ever defined) carries proof of authentication.
- Authentication failures are a distinct error category (§7), never conflated with authorization failures.
- The Staff-Assisted Booking exception already documented in `DOMAIN_MODEL.md`'s `User` invariants must be representable at the API layer — a Staff-authenticated request acting on behalf of an unauthenticated Customer is a real, intentional pattern, not an edge case to design around later.

## 10. Authorization Strategy

Full mechanics are owned entirely by `IDENTITY_AND_ACCESS.md` — referenced here, not redefined. API-level expectations only:

- Every request is authorized against the caller's role/permissions before reaching Domain Layer logic, per `SYSTEM_ARCHITECTURE.md` §6/§8 — enforced at the API/Application Layer boundary, never left to the Domain Layer to self-police.
- A Provider-scoped API request (Provider API, §3) is authorized not just for "is this caller a Provider" but "does this caller own the specific resource requested" — ownership-scoped authorization, not merely role-based.
- AI Agent requests (AI API, §13) are authorized through the identical mechanism as any other caller, per `SYSTEM_ARCHITECTURE.md` §12 — an AI Agent is architecturally just another authenticated, authorized actor with a narrower permission set.

## 11. Event Contracts

- **Business Events:** The domain events already catalogued in `DOMAIN_MODEL.md` §3 (Booking Created, Provider Approved, etc.) — this document does not redefine them, only notes that any business event exposed externally (via Webhooks, §12) must have a stable, versioned event contract, same as any API resource.
- **Integration Events:** Events crossing the Integration Layer boundary (`SYSTEM_ARCHITECTURE.md` §4) to/from third-party systems — shaped by whatever that third party requires, translated at the Integration Layer boundary so internal Business Events never leak their internal shape directly to an external system.
- **Webhook Events:** A subset of Business Events explicitly published externally — governed by §12.
- **Future Event Bus:** Not part of V1's architecture (`SYSTEM_ARCHITECTURE.md` currently uses in-process domain events per Principle 15); a formal event bus is a future evolution item (§17), not a current commitment.

## 12. Webhooks

- **Design Philosophy:** A Webhook is a durable, versioned promise to an external subscriber — treated with the same contract-stability discipline as any other API (§2), not an informal "fire and forget" notification.
- **Retry Policy:** Bounded retries with backoff on delivery failure, consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 22 (Fail Gracefully) — never an infinite retry loop.
- **Idempotency:** Every webhook delivery carries an identifier allowing the receiver to safely handle duplicate delivery, consistent with §5's idempotency requirement applied to outbound events.
- **Signing:** Every webhook payload is signed so the receiver can verify it genuinely originated from BARQ — a security requirement, not optional.
- **Versioning:** Webhook event schemas follow the same Major/Minor/Deprecation discipline as any other API contract (§8) — a webhook consumer is a real API consumer, not a lesser category exempt from versioning discipline.

## 13. AI API Principles

Fully governed by `AI_STRATEGY.md` §2–§4; this section states the API-contract-level implications:

- **Conversation:** AI conversational interactions (Customer Assistant, etc.) are modeled as a distinct request/response pattern from standard CRUD resource access — a conversation has state and turn-taking that a standard resource request does not.
- **Context:** What context an AI request may carry is bounded by `AI_STRATEGY.md` §5 (Approved Knowledge only) and §6 (Memory Strategy) — an API request can't smuggle in unapproved context and have the AI Layer treat it as ground truth.
- **Memory Boundaries:** Per `AI_STRATEGY.md` §6 — Business Memory is never returned to or cached by the caller as if it were AI-owned state; it's always a live read attributed to its owning Bounded Context.
- **Confidence:** Where an AI response is a recommendation rather than a retrieval of fact, the response (§6) must indicate this distinguishably — a confidence signal is a contract-level field, not an implementation detail left to chance.
- **Explainability:** Per `AI_STRATEGY.md` §2's Explainable Decisions principle — an AI API response should be traceable to the knowledge that produced it, consistent with `DATABASE_DESIGN.md` §13's Explainable Context requirement.
- **Human Escalation:** Every AI API interaction has a defined escalation path when confidence is low or the request falls outside the AI Agent's Allowed Actions (`AI_STRATEGY.md` §3–§4) — this is a required response state, not an edge case handled inconsistently per AI role.

## 14. Performance Strategy

- **Pagination:** Per §5–§6, mandatory and consistent.
- **Compression:** Applied to API responses by default, particularly relevant given Mobile First (`ARCHITECTURE_PRINCIPLES.md` Principle 9) bandwidth constraints.
- **Caching:** Cache-appropriate responses (read-heavy, slow-changing, per `SYSTEM_ARCHITECTURE.md` §6/§10) carry explicit caching metadata; responses touching Wallet balance, Availability, or any live-correctness-required data are never cached at the API layer, consistent with the same rule already established at the data layer.
- **Async Processing:** Long-running operations (PDF generation, per `SYSTEM_ARCHITECTURE.md` §10) are exposed as async/polling or webhook-notified patterns at the API layer, never a synchronous request held open indefinitely.
- **Streaming:** A candidate future pattern for AI conversational responses (§13) and possibly live Tracking updates — not committed for V1, flagged in §17.

## 15. Security

- **Rate Limiting:** Applied per API category (§3) at different thresholds — Public API faces the strictest limits given its exposure; Internal API less so, given its trusted-caller context.
- **Replay Protection:** Particularly relevant to OTP-related and webhook-signing (§12) flows — a captured, replayed request must not succeed a second time.
- **Input Validation:** Per §7 — the first line of defense at the API boundary, before Domain Layer logic executes.
- **Output Validation:** APIs never return more data than the caller is authorized to see (§10) — output shaping is itself a security control, not just a convenience.
- **Audit:** Every Admin API, and any API action already flagged as Audit-relevant in `DOMAIN_MODEL.md`/`DATABASE_DESIGN.md` §9, is Audit Logged at the API layer, correlated via §5's Correlation IDs.
- **PII Protection:** API responses respect the same PII classification as `DATABASE_DESIGN.md` §11 — a field classified as PII at the data layer doesn't become casually exposed just because it's convenient for a specific client.
- **Secrets:** Never appear in a URL, query string, or response body, ever, consistent with `PROJECT_RULES.md` §16 and this project's Privacy section on avoiding personal/sensitive data in URLs.

## 16. Observability

- **Request IDs:** Unique per request, distinct from but linked to the Correlation ID (§5) that spans a whole user action.
- **Trace IDs:** Span cross-module calls within a single request, supporting the Observability by Design principle (`ARCHITECTURE_PRINCIPLES.md` Principle 20) at the API layer specifically.
- **Metrics:** Per-API-category latency, error rate, and volume — full detail owned by future `OBSERVABILITY.md`.
- **Logs:** Structured, correlated to Request/Trace/Correlation IDs — never freeform, unstructured text that can't be queried at scale.
- **Audit Correlation:** Every Audit Log entry (`DATABASE_DESIGN.md` §9) that originates from an API call carries that call's Correlation ID, so an audited action and the API request that caused it are always linkable.

## 17. Future Evolution

- **GraphQL:** Not part of V1; a candidate future addition for clients needing flexible querying (e.g. a future Partner API), not a replacement for the primary contract style.
- **gRPC:** A candidate future internal-communication protocol if inter-module communication ever needs to cross a real network boundary (post-extraction, per `SYSTEM_ARCHITECTURE.md` §11) — not relevant while everything remains in-process within the Modular Monolith.
- **Partner APIs:** Per §3 — a defined future category, not a V1 commitment.
- **Public SDKs:** A plausible future investment once a stable, versioned public API surface (§8) has matured enough to be worth wrapping in a client library.
- **Realtime APIs:** A candidate evolution for Tracking and Operations Center use cases (§13's streaming note) — not committed for V1.

## 18. API Anti-Patterns

Explicitly forbidden, without exception:

- Never expose database schema — an API resource shape is a deliberate contract (§4), never a mirror of `DATABASE_DESIGN.md`'s internal table structure.
- Never expose internal IDs in a way that leaks information — UUID v7 (§5) is acceptable as an opaque identifier; anything that additionally leaks sequence, volume, or internal structure is not.
- Never return stack traces — an error response (§7) is a designed contract, never a raw exception dump.
- Never leak business rules — an error message explains that a request violated a rule (§7, Business Rule category) without exposing the rule's internal implementation detail (e.g. exact Commission calculation logic) beyond what the caller legitimately needs to know.
- Never couple clients to implementation — a client depends on the contract (§2), never on incidental implementation detail that happens to be observable today.
- Never bypass authorization — no API path, including AI API (§13) or internal-only paths, skips the authorization boundary established in §10.
- Never bypass audit — no API path that should be Audit Logged (§15) is allowed to skip it for convenience or performance.
- Never expose hidden states — if a `Booking`, `Provider`, or any entity has an internal-only state not meant for API consumers, the API must not leak it through inconsistent enum values or undocumented response shapes.

## 19. Open Decisions

Intentionally deferred — not invented here:

1. ~~Language negotiation mechanism~~ — **Resolved by `LOCALIZATION.md` §3**; no longer an open decision. See §5 above.
2. **Sunset policy duration** for deprecated API versions (§8) — no specific timeline set yet.
3. **Streaming API adoption timing** (§14, §17) — not decided for V1.
4. **Whether a formal Event Bus (§11) is needed**, and when — currently unnecessary given in-process domain events suffice at V1 scale.
5. **Exact rate-limit thresholds per API category** (§15) — a tuning decision appropriately deferred past architecture-level documentation.
6. **GraphQL/gRPC/Public SDK adoption** (§17) — directional future possibilities only, no committed timeline.

---

## Related Documents
- `PROJECT_MANIFEST.md`, `PROJECT_RULES.md` — foundational philosophy and process
- `ARCHITECTURE_PRINCIPLES.md` — Principle 7 (API First), Principle 8 (AI First), and nearly every other principle has an API-layer expression somewhere above
- `DOMAIN_MODEL.md` — §4's resource ownership maps directly to its 15 Bounded Contexts, unchanged
- `BUSINESS_MODEL.md`, `PRODUCT_REQUIREMENTS.md` — inform which API categories (§3) matter for V1 vs. future
- `SYSTEM_ARCHITECTURE.md` — §4–§8, the layering, module boundaries, and AI Layer governance this document's API-level rules enforce at the contract boundary
- `DATABASE_DESIGN.md` — §6–§7, §9, §11 — cross-context reference rules, localization, audit, and security carried through to the API layer
- `AI_STRATEGY.md` — §2–§8, governing §13 in full
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md`, `ADR-0006-database-baseline.md` — architectural decisions this document's conventions are built on
- `AUTHENTICATION.md`, `IDENTITY_AND_ACCESS.md`, `SECURITY.md` — own full mechanics for §9–§10 and security detail respectively
- `EVENTS.md`, `WEBHOOKS.md`, `ERROR_CODES.md`, `REST_API.md`, `OBSERVABILITY.md` *(not yet written)* — each owns implementation-level detail this document intentionally stays above

## Open Questions
1. §9–§10 were originally written against `DOMAIN_MODEL.md` and `SYSTEM_ARCHITECTURE.md` only, before `AUTHENTICATION.md`/`IDENTITY_AND_ACCESS.md` existed. Both now exist — should this document be revised to explicitly cross-check consistency against them, or is a one-way reference (those documents point back here) sufficient? Still flagged, not decided here.
2. Should `REST_API.md` and `EVENTS.md` (both named in the original documentation architecture, not yet written) be sequenced immediately after this document, given how much of this document defers detail to them specifically? Not decided unilaterally here — a sequencing question for whoever directs the next phase.

## Future ADR References
- Any decision to adopt a formal Event Bus, GraphQL, or gRPC (§17) requires an ADR when actually proposed, not a routine documentation update.
- Any resolution of an Open Decision (§19) that becomes a binding architectural commitment requires its own ADR.
