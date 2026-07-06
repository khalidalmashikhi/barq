# ADR-0002: Modular Monolith (Not Microservices)

- **Purpose:** Formally record BARQ's foundational architecture style decision — a Modular Monolith, not Microservices, at this stage of the platform's life.
- **Scope:** The choice between a Modular Monolith and Microservices as BARQ's initial system architecture style, and the module-boundary discipline that choice requires.
- **Out of Scope:** The specific module map (owned by `SYSTEM_ARCHITECTURE.md` §5), database/technology decisions (owned by `ADR-0006`, `ADR-0007`), any implementation detail.
- **Dependencies:** `PROJECT_MANIFEST.md` (Engineering Philosophy §6), `ARCHITECTURE_PRINCIPLES.md` Principle 6 (Modular Monolith) and Principle 26 (Cost-Aware Architecture, adopted later but consistent with the reasoning here from the start).
- **Status:** Approved v1.0 — Locked.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## Context

This ADR is being formally recorded after the fact. BARQ's architecture has been built on the Modular Monolith decision since `SYSTEM_ARCHITECTURE.md` §3 was first drafted, and every subsequent document — `ARCHITECTURE_PRINCIPLES.md` Principle 6, `DOMAIN_MODEL.md`'s Bounded Context structure, `TECH_STACK.md`'s Next.js/Vercel choice, `ADR-0007`, and `ARCHITECTURE_FREEZE_V1.md` itself — has cited "`ADR-0002-modular-monolith.md`" as an existing, Approved, Locked decision. It was never actually created as a standalone file; the decision was real and consistently applied, but the record was not. This ADR closes that gap, reconstructing the decision faithfully from how it has been consistently described and relied upon everywhere else, rather than introducing anything new.

## Decision

BARQ is built as a **Modular Monolith**: one deployable application, internally divided into modules aligned to the Bounded Contexts defined in `DOMAIN_MODEL.md` (Identity, Customer, Provider, Booking, Pricing, Wallet, Payments, Contracts, Invoicing, Notifications, Tracking, Reviews, Operations, Administration, AI), with strictly enforced boundaries between them. Modules do not reach into each other's internals — cross-module interaction happens through explicitly defined interfaces and domain events (`ARCHITECTURE_PRINCIPLES.md` Principle 15), the same discipline microservices would force via network boundaries, enforced here via code and data-access boundaries instead (`ADR-0006`'s cross-module access rule).

**Microservices are intentionally postponed**, not rejected outright. Microservices solve problems BARQ does not yet have — independent scaling of specific capabilities under real load, independent team ownership at a scale where a monolith's coordination cost exceeds its simplicity benefit, and polyglot technology needs. At BARQ's Salalah-launch scale (`PRODUCT_REQUIREMENTS.md` §5), none of these problems exist yet, while the costs of microservices — network overhead, distributed transaction complexity, operational burden, and infrastructure spend — are real and immediate. Adopting microservices now would violate Cost-Aware Architecture: premature infrastructure complexity chosen for a scale BARQ has not reached.

The Modular Monolith preserves the *option* to extract specific modules into independent services later (`SYSTEM_ARCHITECTURE.md` §5's per-module "Future Extraction Potential," §11's Extraction Strategy) without paying that cost today — because the internal module boundaries this ADR requires already exist and are already enforced, extraction becomes a deployment change later, not an architectural rewrite.

## Alternatives Considered

- **Full Microservices at launch:** Rejected — solves scaling problems BARQ doesn't have yet, at an infrastructure and coordination cost it shouldn't pay yet.
- **Undifferentiated Monolith (no internal module boundaries):** Rejected — would violate Domain-Driven Design and Clean Architecture (`ARCHITECTURE_PRINCIPLES.md` Principles 4–5) and make future extraction, or even confident reasoning about the system, effectively impossible without a rewrite.
- **Serverless/function-based decomposition:** Rejected as a poor structural fit for a domain this stateful and transaction-heavy (Booking, Wallet), and premature relative to Cost-Aware Architecture.

## Consequences

**Positive:** A single deployable application with genuine internal discipline gives BARQ the operational simplicity and cost profile its current stage needs, while keeping a real, non-theoretical path to extracting specific modules later, since the boundaries this ADR requires already exist.

**Negative / Cost:** Module boundary discipline (`ADR-0006`'s cross-module access rule) requires ongoing engineering discipline that a less-structured monolith would not — accepted deliberately, since the alternative (an undifferentiated monolith) was already rejected above for exactly this reason.

**Follow-up Required:** None outstanding — this ADR formalizes a decision every dependent document already correctly assumed was Locked. No dependent document requires revision as a result of this ADR's creation; each already described the decision consistently with what is recorded here.

---

## Related Documents
- `SYSTEM_ARCHITECTURE.md` §3, §5, §11 — the fullest existing elaboration of this decision, which this ADR formalizes rather than supersedes
- `ARCHITECTURE_PRINCIPLES.md` Principle 6 — the principle-level statement of this same decision
- `DOMAIN_MODEL.md` — the Bounded Contexts this ADR's modules align to
- `ADR-0006-database-baseline.md` — the cross-module access rule that enforces this ADR's boundaries at the persistence layer
- `ADR-0007-frontend-backend-hosting-stack.md` — the technology choice made consistent with this architecture style
- `ARCHITECTURE_FREEZE_V1.md` — lists this ADR among "Approved ADRs" already in Scope; this ADR's creation makes that listing accurate rather than aspirational

## Open Questions
- None at this time.

## Future ADR References
- Any future decision to extract a specific module into an independently deployed service, per `SYSTEM_ARCHITECTURE.md` §5/§11's extraction strategy, requires an ADR that supersedes this one's scope for that module specifically — this is the same class of decision as the original monolith-vs-microservices choice, in reverse.
- Any future decision to adopt microservices platform-wide, rather than extracting individual modules incrementally, requires a superseding ADR at the highest review tier.
