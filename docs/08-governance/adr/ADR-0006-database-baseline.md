# ADR-0006: Database Baseline (PostgreSQL, Prisma ORM, and Core Data Conventions)

- **Purpose:** Formally record BARQ's Database Baseline decisions — primary database technology, ORM, primary key strategy, time strategy, money/currency strategy, file storage strategy, and the Audit/Activity Log and cross-module access rules that govern all persistent data.
- **Scope:** The specific technology and convention choices listed in the Decision section below.
- **Out of Scope:** The full data architecture built on top of these choices (owned by `DATABASE_DESIGN.md`), any schema, migration, or implementation detail.
- **Dependencies:** `ADR-0002-modular-monolith.md` (cross-module access rule enforces module boundaries at the data layer), `SYSTEM_ARCHITECTURE.md` §9 (which flagged Database as High Reversal Cost, requiring this ADR before implementation), `ARCHITECTURE_PRINCIPLES.md` Principle 26 (Cost-Aware Architecture), `ADR-0005-bilingual-architecture.md` (Currency/Money strategy and future localization strategy must remain compatible with it).
- **Status:** Approved v1.0 — Locked upon acceptance.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## Context

`SYSTEM_ARCHITECTURE.md` §9 stated the Database decision at the category level only ("a relational database") and explicitly flagged it as High Reversal Cost, requiring a dedicated ADR naming the specific technology before implementation begins. This ADR fulfills that obligation, consistent with `PROJECT_RULES.md` §4 (ADRs reserved for decisions expensive to reverse).

## Decision

- **Primary Database:** PostgreSQL. Satisfies `SYSTEM_ARCHITECTURE.md` §9's relational-database rationale (Wallet ledger integrity, Booking/Price fixation, Commission calculation all require strong transactional consistency) with a mature, cost-effective, widely-supported engine — consistent with Cost-Aware Architecture.
- **ORM:** Prisma ORM. Satisfies §9's type-safety and migration-tooling rationale; pairs naturally with a TypeScript-based backend (backend runtime itself remains a separate, still-open High Reversal Cost decision per `SYSTEM_ARCHITECTURE.md` §9/Open Questions).
- **Primary Keys:** UUID v7. Chosen over sequential integers or UUID v4 for time-ordered, globally-unique, index-friendly identifiers — relevant given BARQ's eventual multi-tenant, multi-region ambitions (`BUSINESS_MODEL.md` §12), where globally unique, non-coordinated ID generation matters more than in a single-database, single-region system.
- **Time Strategy:** All timestamps stored in UTC; conversion to local timezone happens only at the presentation layer. Prevents timezone ambiguity in a system that will eventually span multiple GCC countries/timezones.
- **Money Strategy:** Decimal/Numeric types only for monetary values — never Float or Double. Floating-point rounding error is unacceptable for Wallet, Commission, and Payment data, per the financial-integrity invariants already established in `DOMAIN_MODEL.md`.
- **Currency Strategy:** Money is represented as an (Amount, Currency) pair, never a bare number. Oman Rial (OMR) is the current default, but the representation itself must not assume OMR permanently, given `BUSINESS_MODEL.md` §12's GCC/international expansion trajectory.
- **File Storage:** The database stores file metadata only; actual files (Invoice/Contract PDFs, any future media) live in Object Storage, consistent with `SYSTEM_ARCHITECTURE.md` §9's Storage decision.
- **Audit Strategy:** Audit Log and Activity Log remain two distinct concepts at the data layer, never merged into one table or stream — consistent with `GLOSSARY.md` terms 26–27 and every architectural document that has preserved this distinction so far.
- **Cross-Module Access:** A module never directly accesses another module's tables without explicit architectural justification recorded at the point of exception. This is `ADR-0002`'s Modular Monolith boundary enforcement (`ARCHITECTURE_PRINCIPLES.md` Principle 6), applied specifically to the persistence layer.

## Alternatives Considered

- **NoSQL/document-oriented primary store:** Rejected — weaker transactional guarantees for financial data, a poor fit for Wallet's ledger-immutability invariant, as already reasoned in `SYSTEM_ARCHITECTURE.md` §9.
- **Sequential integer primary keys:** Rejected in favor of UUID v7 — sequential IDs leak information (record count, creation order) and complicate future multi-region ID generation without coordination.
- **Storing files as database BLOBs:** Rejected — explicitly named as an anti-pattern; bloats the database, complicates backup/scaling, and contradicts Cost-Aware Architecture at any real file volume.
- **Storing amounts as Float/Double:** Rejected outright — not a reasonable option for financial data under any framing.
- **Single unified Audit/Activity log table:** Rejected — would blur a distinction this project has repeatedly and deliberately protected.

## Consequences

- **Positive:** Establishes a stable, reasoned data foundation before any implementation begins, closing one of `SYSTEM_ARCHITECTURE.md`'s two remaining High Reversal Cost gaps (Database). Gives `DATABASE_DESIGN.md` firm ground to build its full data architecture on.
- **Negative / Cost:** PostgreSQL and Prisma require standard operational familiarity; this is a normal cost, not a special one, for a team building a relational-consistency-dependent domain.
- **Follow-up Required:** Backend runtime/language and Frontend framework remain open High Reversal Cost decisions per `SYSTEM_ARCHITECTURE.md` §9's Open Questions — Prisma's TypeScript orientation is a relevant input to the Backend decision when it is made, not a predetermination of it.

---

## Related Documents
- `SYSTEM_ARCHITECTURE.md` — §9, the document this ADR closes a gap in
- `DATABASE_DESIGN.md` — the data architecture built on top of this ADR's decisions
- `ADR-0002-modular-monolith.md` — the cross-module access rule this ADR applies to the persistence layer
- `ADR-0005-bilingual-architecture.md` — constrains the Currency Strategy and future localization data strategy
- `GLOSSARY.md` — terms 26–27, the Audit Log/Activity Log distinction preserved here

## Open Questions
- None at this time — this ADR resolves the Database/ORM/core-conventions decision it was raised to make.

## Future ADR References
- Backend runtime/language and Frontend framework remain separately open per `SYSTEM_ARCHITECTURE.md` §9 and require their own ADRs.
- Any future change to Primary Database, ORM, Primary Key strategy, Time Strategy, Money Strategy, or Currency Strategy requires an ADR that explicitly supersedes this one.
