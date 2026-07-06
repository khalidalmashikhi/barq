# BARQ Glossary

- **Purpose:** Establish the single, official set of English and Arabic terms used across all BARQ documentation, product surfaces, and (later) code. No other document may introduce a competing term for a concept already defined here.
- **Scope:** Core domain nouns and roles (people, assets, money, operations, AI, platform/architecture concepts) that appear in more than one document or across product surfaces.
- **Out of Scope:** Field-level naming (e.g. exact database column names, API property names), UI copy/microcopy, and marketing taglines. Those belong to `DATABASE_DESIGN.md`, `API_STANDARDS.md`, and `BRANDING.md` respectively, and must use — but not redefine — the terms below.
- **Dependencies:** None. This is a Phase 0 foundation document; nothing precedes it.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## 1. How to Use This Document

- Every term below has one **canonical English term** and one **canonical Arabic term**. Documents, screens, and code must use these exactly — no synonyms (e.g. never "Vendor" once "Service Provider" is defined here).
- If a document needs a term that isn't listed here, it must be proposed as an addition to this glossary (via review, not invented silently) before being used elsewhere.
- Arabic terms are given in Modern Standard Arabic, chosen for clarity in a professional/commercial context rather than colloquial Gulf usage, since the platform must read as premium and precise in both languages.
- This document defines **what a term means**, not how it is implemented. Mechanics live in the owning capability document (see cross-references in each entry).

---

## 2. Core Roles & Actors

| # | English Term | Arabic Term | Definition |
|---|---|---|---|
| 1 | **Customer** | العميل | An end user who books services through BARQ. Does not need to create their own account to be booked for (see *Staff-Assisted Booking*). |
| 2 | **Service Provider** | مزوّد الخدمة | A business or individual entity offering one or more bookable services (transport, tours, guiding, experiences) on BARQ. Not limited to transport — deliberately broader than "Driver" or "Operator." |
| 3 | **Driver** | السائق | An individual who operates a vehicle on behalf of a Service Provider to fulfill a booking. A Driver is always associated with a Service Provider; a Driver is not itself a Service Provider. |
| 4 | **Guide** | المرشد السياحي | An individual who delivers a guided tourism experience on behalf of a Service Provider. Distinct from Driver — a booking may require a Guide, a Driver, both, or neither. |
| 5 | **Asset** | الأصل | Any physical resource owned or registered by a Service Provider that can be assigned to a booking — primarily vehicles, but the term is deliberately generic to allow future asset types (e.g. boats, equipment) without renaming. |
| 6 | **Vehicle** | المركبة | A specific type of Asset used for transport-based bookings. |
| 7 | **Staff** | الموظف | A BARQ-employed operations team member with permission to create Customers and Bookings on their behalf, typically over the phone. See *Staff-Assisted Booking*. |
| 8 | **Admin** | المسؤول | A BARQ-employed role with configuration and oversight permissions over the platform (commission tiers, provider approval, etc.), distinct from Staff, who operate day-to-day bookings. |
| 9 | **AI Agent** | الوكيل الذكي | An autonomous or semi-autonomous software component that acts within defined boundaries on behalf of the platform, a Customer, or Staff. Governed by `AI_STRATEGY.md` and `AI_GUARDRAILS.md`. |
| 10 | **Tenant** | المستأجر | An isolated logical instance of BARQ, e.g. a country-level deployment (Oman, then future GCC markets). See `MULTI_TENANCY_AND_SCALABILITY.md`. |

## 3. Booking & Operations Terms

| # | English Term | Arabic Term | Definition |
|---|---|---|---|
| 11 | **Booking** | الحجز | A confirmed request from a Customer (or Staff, on a Customer's behalf) for a Service Provider's service at a specific time. The single canonical term — "Reservation" and "Trip" are not used interchangeably with it. |
| 12 | **Staff-Assisted Booking** | الحجز بمساعدة الموظف | A Booking created by Staff on behalf of a Customer identified only by phone number, without the Customer needing to register through the app first. |
| 13 | **Service** | الخدمة | A bookable offering listed by a Service Provider (e.g. an airport transfer, a guided desert tour). A Booking is always a Booking *of* a Service. |
| 14 | **Live Tracking** | التتبع المباشر | Real-time location sharing of a Driver/Asset during an active Booking, visible to the Customer and Operations Center. |
| 15 | **Operations Center** | مركز العمليات | The real-time, live-data monitoring and dispatch interface used by Staff/Admin to oversee active Bookings, Drivers, and incidents. Distinct from the Admin Dashboard, which is not real-time. |
| 16 | **Admin Dashboard** | لوحة تحكم المسؤول | The management interface for configuration, reporting, and record administration (Providers, Users, Commission Tiers, etc.) — not for real-time operational monitoring. |
| 17 | **Dispute** | النزاع | A formal disagreement raised by a Customer or Service Provider regarding a Booking, typically involving a refund claim. See `CUSTOMER_SUPPORT_AND_DISPUTES.md`. |

## 4. Commercial & Financial Terms

| # | English Term | Arabic Term | Definition |
|---|---|---|---|
| 18 | **Commission** | العمولة | The percentage of a Booking's value retained by BARQ, paid by the Service Provider. |
| 19 | **Commission Tier** | فئة العمولة | One of BARQ's three defined commission rates (12%, 10%, 8%) assigned to a Service Provider. Assignment rules are owned by `PRICING_AND_COMMISSION.md`, not this glossary. |
| 20 | **Provider-Set Pricing** | التسعير من قِبل المزوّد | The principle that Service Providers — not BARQ — set the price of their own Services. |
| 21 | **Wallet** | المحفظة | A BARQ-managed internal balance held per Service Provider (and optionally per Customer) representing funds owed, earned, or available. See `PAYMENTS_AND_WALLET.md`. |
| 22 | **Payout** | الدفعة المستحقة | A transfer of Wallet funds from BARQ to a Service Provider. |
| 23 | **Invoice** | الفاتورة | A legally formatted document issued for a completed, billable Booking. |
| 24 | **Contract** | العقد | A legally binding agreement between BARQ and a Service Provider or Customer, distinct from an Invoice (which is transactional, not an agreement). |
| 25 | **Refund** | الاسترداد | The return of funds to a Customer for a cancelled or disputed Booking. |

## 5. Trust, Compliance & Technical Terms

| # | English Term | Arabic Term | Definition |
|---|---|---|---|
| 26 | **Activity Log** | سجل النشاط | A record of routine, expected user or system actions (e.g. "Customer updated phone number"), used for operational visibility. Not the same as an Audit Log. |
| 27 | **Audit Log** | سجل التدقيق | An immutable record of security- or compliance-relevant actions (e.g. "Admin changed Commission Tier"), used for accountability and legal defensibility. Deliberately kept distinct from Activity Log — see `AUDIT_AND_ACTIVITY_LOGGING.md`. |
| 28 | **OTP (One-Time Password)** | رمز التحقق المؤقت | A single-use code used to verify a phone number during registration or login, without a traditional password. |
| 29 | **Bounded Context** | السياق المحدود | A Domain-Driven Design term for a self-contained area of the domain model with its own consistent language and rules (e.g. Booking, Identity, Wallet). Defined per-context in `DOMAIN_MODEL.md`. |
| 30 | **Modular Monolith** | البنية الأحادية المُقسّمة | BARQ's chosen architectural style (see `ADR-0002`): a single deployable application internally divided into strictly separated modules aligned to Bounded Contexts, as opposed to independently deployed microservices. |

## 6. AI-Specific Terms

| # | English Term | Arabic Term | Definition |
|---|---|---|---|
| 31 | **AI Agent Guardrail** | ضابط الوكيل الذكي | A hard boundary defining what an AI Agent is not permitted to do autonomously, regardless of instruction. Owned by `AI_GUARDRAILS.md`. |
| 32 | **Human-in-the-Loop** | تدخل بشري في الحلقة | A required point at which a human must approve or review an AI Agent's action before it takes effect. |
| 33 | **Agent Memory** | ذاكرة الوكيل | Information an AI Agent is permitted to retain across interactions. Scope and limits owned by `AI_MEMORY.md`. |

---

## Related Documents
- `PROJECT_RULES.md` — operating rules that govern how this and all documents are written and maintained
- `ARCHITECTURE_PRINCIPLES.md` — will reference Bounded Context, Modular Monolith
- `AI_STRATEGY.md` — will reference AI Agent, Guardrail, Human-in-the-Loop, Agent Memory
- `BUSINESS_MODEL.md` — will reference Commission, Commission Tier, Provider-Set Pricing
- `BARQ_BIBLE.md` — will link here as the terminology source once created (post Phase 0)

## Open Questions
1. Should Gulf-market colloquial Arabic variants be documented alongside MSA for customer-facing UI copy, or is that entirely `LOCALIZATION.md`'s concern? (Proposed: entirely out of scope here — flag for `LOCALIZATION.md`.)
2. Do we need a distinct term for a Service Provider that offers *only* Assets for rent without Drivers/Guides (i.e. self-drive rental), or does "Service Provider" already cover this without ambiguity?
3. Is "Tenant" the right long-term term once GCC expansion begins, or should country-level separation use a different word to avoid confusion with multi-tenant SaaS terminology in a different sense? To be resolved in `MULTI_TENANCY_AND_SCALABILITY.md`.
4. Should "Asset" and "Vehicle" be merged into one term now, given only vehicles exist at launch? (Proposed: keep separate now — cheaper to keep a distinction than to retrofit one later.)

## Future ADR References
- None yet. Any change to a term defined here after this document reaches v1.0/Locked requires an ADR, per the documentation lifecycle.
