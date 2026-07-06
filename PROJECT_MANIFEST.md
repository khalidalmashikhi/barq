# BARQ Project Manifest

- **Purpose:** Establish the permanent, foundational identity of BARQ — why it exists, what it stands for, and what may never be compromised regardless of feature, market, or technology change.
- **Scope:** Purpose, Vision, Mission, Core Values, Product/Engineering/AI/Design Philosophy, Customer Promise, Provider Promise, Quality Standard, Decision Framework, Long-Term Vision.
- **Out of Scope:** Any operational detail — feature specs, architecture choices, tech stack, business model mechanics, pricing. If a statement here could be true regardless of what BARQ builds next year, it belongs here. If it would need to change when a feature ships, it belongs in `BARQ_BIBLE.md` or below.
- **Dependencies:** None. This is the root document of the entire project. Every other document, including `BARQ_BIBLE.md`, is subordinate to this one.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## 1. Purpose

BARQ exists to make premium tourism operations in Oman — and later the wider GCC — as fast, trustworthy, and dignified for everyone involved as the experience itself should feel for the traveler. Tourism operators in this region deserve infrastructure as good as the destinations they represent. BARQ is that infrastructure.

## 2. Vision

A GCC-wide operations layer for tourism that every serious service provider — driver, guide, fleet operator, experience host — chooses to run their business on, and every traveler trusts by default, because BARQ made reliability and premium experience the same thing.

## 3. Mission

Give tourism service providers a fair, fast, transparent way to reach customers and run their operations — and give customers a single, trustworthy, beautifully simple way to book real experiences — without either side having to compromise on speed, trust, or dignity to get there.

## 4. Core Values

1. **Trust is the product.** Every technical and business decision is filtered through: does this make BARQ more trustworthy, or less?
2. **Speed with no shortcuts.** Fast for the user; never fast at the expense of correctness, security, or architecture.
3. **Dignity for providers.** Service Providers are partners, not inventory. Their pricing, their brand, their business — BARQ is the rail they run on, not the hand that squeezes them.
4. **Arabic is not a translation.** Arabic-first is an identity commitment, not a localization checkbox added after the English product is done. This is a binding architectural principle, not a value statement alone — see `ADR-0005-bilingual-architecture.md`.
5. **Premium is a discipline, not a decoration.** Premium means restraint, clarity, and reliability — not visual excess.
6. **Documentation is how we think, not paperwork we do after.** If it isn't written down, it isn't decided.

## 5. Product Philosophy

BARQ is built for real operations, not demos. Every feature must survive contact with a Staff member on the phone with a customer, a driver stuck in traffic, or a provider disputing a commission — not just a clean happy-path walkthrough. Simplicity for the customer; power and control for the operator.

## 6. Engineering Philosophy

Clean, domain-driven architecture. No duplicate logic — one place owns one truth. We start as a Modular Monolith by deliberate choice (see `ADR-0002`), not as a default or a shortcut, and we evolve architecture only through recorded decisions, never through drift. Documentation precedes design; design precedes architecture; architecture precedes implementation; implementation is always followed by testing and a documentation update. This sequence is not optional under deadline pressure — it is the thing that protects us from deadline pressure.

## 7. AI Philosophy

BARQ is AI-first, meaning AI is a designed-in capability with explicit boundaries — not an autonomous actor with implicit trust. Every AI Agent operates inside guardrails defined before the agent is built, with human-in-the-loop review at every point where an autonomous action could affect money, trust, or a person's data. AI accelerates BARQ's team and its users; it never operates as an unaccountable black box making decisions no human reviewed.

## 8. Design Philosophy

Mobile-first, Arabic-first with full English support, premium and light. Interfaces must feel calm and effortless in both languages and both reading directions — RTL is a first-class layout mode, not a mirrored afterthought. Premium is expressed through clarity, whitespace, typography, and speed — not ornamentation.

BARQ is **bilingual by design**, formalized as a binding architectural principle in `ADR-0005-bilingual-architecture.md`. This is not a UI statement alone — it constrains product, UX, AI, APIs, database design, and documentation equally. No feature, in any layer, is complete unless Arabic and English carry full parity. This constraint is permanent, belongs at the Manifest level because it will never change, and does not get re-litigated by any individual feature specification.

## 9. Customer Promise

Booking a real tourism experience through BARQ will be as fast as messaging a friend, as trustworthy as a bank transaction, and as clear in Arabic as it is in English. A customer never needs to understand BARQ's internal complexity to trust its outcome.

## 10. Provider Promise

BARQ will never obscure how a provider is paid, what BARQ's commission is, or why. Providers set their own prices. Commission tiers are transparent and predictable. BARQ succeeds when its providers succeed — not by extracting value invisibly, but by making their operations run better than they could alone.

## 11. Quality Standard

If it isn't documented, it isn't decided. If it isn't tested, it isn't done. If it isn't secure, it isn't shippable. If it doesn't work correctly in Arabic first, it isn't finished. "Good enough for now" is only acceptable when it's written down as a recorded, intentional decision — never as an accident of rushing.

## 12. Decision Framework

When a decision is unclear, resolve it in this order:
1. Does this uphold trust (for customers and providers alike)?
2. Does this preserve long-term architecture over short-term convenience?
3. Is this Arabic-first and mobile-first by default, not by retrofit?
4. Is this the simplest solution that is still correct and secure?
5. Is this documented before it is built?

If a decision would violate one of the Core Values to satisfy a deadline, the deadline moves — not the value.

## 13. Long-Term Vision

BARQ becomes the operating system for tourism experiences across the GCC: the layer that service providers trust to represent them fairly, that operations teams trust to run smoothly, that AI agents trust to act safely within, and that travelers trust without having to think about it at all. Everything else — every feature, every market, every technology choice — serves this and may change; this Manifest is the one thing that does not.

---

## Related Documents
- `BARQ_BIBLE.md` — the operational charter, subordinate to this Manifest, translating these philosophies into concrete platform structure
- `ADR-0004-project-manifest.md` — records why this document exists above `BARQ_BIBLE.md`
- `ADR-0005-bilingual-architecture.md` — records bilingual-by-design as a binding architectural principle referenced in Core Value 4 and Design Philosophy (§8)
- `PROJECT_RULES.md` *(not yet written)* — will operationalize the Engineering Philosophy (Section 6) into enforceable rules
- `ARCHITECTURE_PRINCIPLES.md`, `AI_STRATEGY.md`, `DESIGN_SYSTEM.md` *(not yet written)* — each is obligated, per `ADR-0005`, to cite and operationalize bilingual-by-design when drafted

## Open Questions
1. Should this Manifest itself ever be versioned beyond wording refinements, or is any future *substantive* change to it definitionally a new company, not a new version? (Proposed: treat substantive change as requiring the highest possible review bar — full founder/leadership sign-off, recorded via ADR, not a routine documentation update.)
2. Is "GCC-wide" the right permanent scope for the Vision, or should the Vision be phrased market-agnostically so it doesn't need revisiting if expansion ever extends beyond the GCC? (Flagging for review rather than deciding unilaterally.)

## Future ADR References
- `ADR-0004-project-manifest.md` — establishes this document's existence and authority above `BARQ_BIBLE.md`
- `ADR-0005-bilingual-architecture.md` — establishes bilingual-by-design as binding across product, UX, AI, APIs, database, and documentation
- Any future substantive edit to this Manifest requires a new ADR at the highest review tier.
