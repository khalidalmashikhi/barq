# BARQ Product Requirements

- **Purpose:** Define what BARQ will build and why. This is the single source of truth for all product features — every future feature must originate here before implementation.
- **Scope:** Product vision (by reference), goals, personas, MVP scope, functional requirements by module, non-functional requirements, user journeys, product-level success metrics, constraints, future releases, prioritization, risks, and V1 acceptance criteria.
- **Out of Scope:** Technical specifications, UI layouts/wireframes (owned by future `docs/05-ux/`), API contracts (owned by `API_STANDARDS.md`/`REST_API.md`), database schemas (owned by `DATABASE_DESIGN.md`), any implementation detail.
- **Dependencies:** `PROJECT_MANIFEST.md` (Vision/Mission — referenced, not repeated), `GLOSSARY.md` (all terms below are Glossary-canonical), `DOMAIN_MODEL.md` (every module in §7 maps to a Bounded Context already defined there), `BUSINESS_MODEL.md` (§2–§4, §9 — MVP scope reflects the business model's provider breadth and acquisition priorities), `ARCHITECTURE_PRINCIPLES.md` (Mobile First, Bilingual by Design, AI First — this document's NFRs in §8 operationalize these at the product level), `AI_STRATEGY.md` (§8's AI Safety NFR and §5's AI Assistant scope both defer to it).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect / Product Manager (BARQ core team).

---

## 1. Executive Summary

BARQ V1 is a managed tourism-operations marketplace launching in Salalah, Oman: a mobile-first, Arabic-first web platform where verified Service Providers (drivers, guides, tour operators, fleet owners) list bookable Services and Experiences, Customers book and track them in real time, and BARQ's own Staff and Admin can run the operation — including creating bookings by phone for Customers who never open the app. V1 ships with the minimum complete set of capabilities needed for BARQ to be trustworthy and usable end-to-end: authentication, provider verification, bookings, provider-set pricing with tiered commission, wallet, invoicing, contracts, WhatsApp notifications, live tracking, reviews, a basic trust score, support, and a bilingual AI Assistant — all built on the domain and architectural foundation already established in `DOMAIN_MODEL.md` and `ARCHITECTURE_PRINCIPLES.md`. What V1 deliberately does not include (§6) is as important to this document as what it does.

## 2. Product Vision

BARQ's product vision is the direct execution of `PROJECT_MANIFEST.md`'s Vision, Mission, and Customer/Provider Promises (§2, §3, §9, §10) — referenced here, not restated, per SSOT. This document's role is to translate that permanent vision into what gets built, in what order, starting with V1.

## 3. Product Goals

- **Business Goals:** Validate the managed-marketplace model in one contained market (Salalah) before expanding (per `BUSINESS_MODEL.md` §12); establish commission-based revenue on delivered Bookings only; build the trust position described in `BUSINESS_MODEL.md` §10–§11 from day one, not retrofitted after launch.
- **Customer Goals:** Book a verified tourism service quickly, in Arabic or English, with visible upfront pricing and real-time tracking, and get help fast if something goes wrong.
- **Provider Goals:** Reach Customers directly, keep control of pricing (Provider-Set Pricing), understand commission transparently, and get paid predictably via Wallet.
- **Operations Goals:** Give Staff the ability to serve a Customer who only calls in (Staff-Assisted Booking), and give the Operations Center real-time visibility into active Bookings and Journeys.

## 4. Personas

### Tourist
- **Goals:** Book trustworthy tourism experiences in Oman without needing local knowledge or connections.
- **Pain Points:** Language barrier if Arabic-only options dominate; no way to verify a provider's legitimacy before booking; unclear pricing.
- **Needs:** English-language support with full parity; visible, verified pricing; a way to track their driver/guide in real time.
- **Success Criteria:** Completes a booking in under a few minutes; feels confident before, during, and after the service.

### Local Customer
- **Goals:** Book transport or experiences for personal or family use, often preferring Arabic and phone-based interaction.
- **Pain Points:** Existing informal booking (calling a known driver) has no accountability if something goes wrong; no easy price comparison.
- **Needs:** Arabic-first experience; option to book via Staff by phone without needing the app at all.
- **Success Criteria:** Can book as easily by phone as through the app; trusts BARQ the way they'd trust a known personal contact.

### Driver
- **Goals:** Get consistent bookings without losing pricing control or being displaced by an intermediary.
- **Pain Points:** Informal networks are inconsistent; no transparent path to reach new Customers; commission/payment terms elsewhere are often opaque.
- **Needs:** Clear commission tier visibility, predictable Wallet payouts, straightforward booking assignment.
- **Success Criteria:** Understands exactly what they earn per Booking before accepting it; gets paid on a predictable schedule.

### Tour Guide
- **Goals:** Reach Customers directly for guided Experiences without relying solely on a tour company's informal referral network.
- **Pain Points:** Similar to Driver — inconsistent demand, no direct customer channel, unclear compensation terms.
- **Needs:** A way to list Experiences with their own pricing; visibility into upcoming assigned Bookings.
- **Success Criteria:** Receives Bookings that match their stated Availability and Experience listings without manual back-and-forth.

### Fleet Owner
- **Goals:** Operate multiple Vehicles/Drivers under one business account efficiently.
- **Pain Points:** No unified tool to manage multiple Assets and Drivers; manual dispatch and tracking.
- **Needs:** A Provider account model that supports multiple Assets and Drivers (per `DOMAIN_MODEL.md` Provider-to-Asset relationship) without needing a separate account per vehicle.
- **Success Criteria:** Can view and manage all their Vehicles/Drivers and their Bookings from one Provider account.

### Tourism Company
- **Goals:** Replace disconnected manual tools (spreadsheets, phone calls) with a real operational system.
- **Pain Points:** No visibility across multiple Guides/Vehicles/Experiences at once; administrative overhead scales with growth.
- **Needs:** The same Provider-side tooling as a Fleet Owner, scaled to a larger, more varied set of Drivers/Guides/Vehicles/Services/Experiences.
- **Success Criteria:** Onboarding a new Driver/Guide/Vehicle/Service under their account takes minutes, not a manual back-office process.

### BARQ Staff
- **Goals:** Serve Customers who call in directly, and support Providers day-to-day.
- **Pain Points:** Without Staff-Assisted Booking, any phone-based Customer would be unservable — a real gap in a market where not everyone books via app.
- **Needs:** The ability to create a Customer record and a Booking directly from a phone call, attributed to them in the Audit Log per `GLOSSARY.md` term 27.
- **Success Criteria:** Can complete a phone-based booking in comparable time to a self-service app booking.

### Operations Agent
- **Goals:** Maintain real-time situational awareness over active Bookings and Journeys.
- **Pain Points:** Without a live view, problems are discovered only after a complaint arrives.
- **Needs:** The Operations Center capability (`DOMAIN_MODEL.md` §1, Operations Bounded Context) — live status of active Journeys, Support Ticket visibility.
- **Success Criteria:** Can identify and respond to an emerging issue (e.g. a Journey running unusually long) before the Customer has to report it.

### Admin
- **Goals:** Maintain platform integrity — Provider quality, commission policy, configuration correctness.
- **Pain Points:** Without clear tooling, approval and configuration decisions risk being inconsistent or undocumented.
- **Needs:** The Admin Dashboard capability (`DOMAIN_MODEL.md` §1, Administration Bounded Context) — Provider approval workflow, Commission Tier configuration, Audit Log visibility.
- **Success Criteria:** Every Provider approval and configuration change is deliberate, reviewable, and logged — never informal or undocumented.

## 5. MVP Scope

V1 includes, at minimum:

- **Customer Web App** — mobile-first, responsive web experience (see note below on "Web App" vs. Native).
- **Provider Portal** — for Service Providers, Drivers, Guides, Fleet Owners, and Tourism Companies to manage their own listings, Availability, and Wallet.
- **Operations Center** — real-time monitoring capability for Staff/Operations Agents.
- **Admin Dashboard** — configuration and approval capability for Admins.
- **Authentication** — OTP-based, per `GLOSSARY.md` term 28.
- **Bookings** — including Staff-Assisted Booking.
- **Vehicles** — Vehicle/Asset registration and management.
- **Services** and **Experiences** — listing and Availability management.
- **Pricing** — Provider-Set Pricing.
- **Wallet** — balance and payout visibility.
- **Invoices** — generated per completed Booking, bilingual.
- **Contracts** — Provider/Customer agreement records.
- **Notifications** — via WhatsApp as primary channel.
- **Tracking** — live location during an active Journey.
- **Ratings** and **Reviews** — post-Booking Customer feedback.
- **Support** — basic Support Ticket creation and Staff triage.
- **Arabic** and **English** — full parity per `ADR-0005`, from V1's first release, not added after.
- **AI Assistant** — at minimum, the Customer Assistant role from `AI_STRATEGY.md` §3, within its defined boundaries.
- **WhatsApp Notifications** — the primary delivery channel for Notifications.
- **PDF Generation** — for Invoices and Contracts.
- **Provider Verification** — the Approval gate defined in `DOMAIN_MODEL.md`.
- **Trust Score (basic)** — a simple, clearly-scoped initial version (see Open Questions — the full Trust Score concept remains undefined per `BUSINESS_MODEL.md` §10's own open question).

**Note on Customer Web App vs. Mobile-First:** `ARCHITECTURE_PRINCIPLES.md` Principle 9 (Mobile First) is a design/technical constraint about prioritizing mobile constraints, not a commitment to a native mobile app specifically. V1 satisfies Mobile First through a mobile-first responsive web experience; native apps are explicitly Out of MVP (§6). This is stated here so the two aren't read as contradictory.

## 6. Out of MVP

Explicitly **not** built in V1:

- Native Mobile Apps (iOS/Android) — V1 is web-based, per §5's note above.
- Subscriptions, Advertising, Enterprise APIs, Analytics Services, Featured Listings (all listed as *future* revenue possibilities in `BUSINESS_MODEL.md` §6, not V1 commitments).
- Dynamic/algorithmic Pricing — V1 preserves pure Provider-Set Pricing with no BARQ-side pricing algorithm.
- AI Dispatch or any autonomous AI action — consistent with `AI_STRATEGY.md` §4; V1 AI is assistive/recommendation-only.
- Offline Mode.
- Marketplace Expansion beyond Salalah (per `BUSINESS_MODEL.md` §12's staged rollout — Oman/GCC/International expansion is explicitly a post-V1 concern).
- Insurance (flagged as future in `BUSINESS_MODEL.md` §10).
- Advanced Trust Score modeling (V1 ships only the basic version per §5).
- Multi-tenancy activation across markets (the architecture supports it per `ARCHITECTURE_PRINCIPLES.md` Principle 21, but V1 operates a single market/tenant).

## 7. Functional Requirements

Organized by module; each maps to a Bounded Context already defined in `DOMAIN_MODEL.md`, referenced rather than redefined.

### Authentication & Identity
- **Purpose:** Verify who is acting on the platform.
- **Capabilities:** Phone-number OTP registration/login; Staff-initiated Customer creation without the Customer authenticating themselves.
- **User Actions:** Request OTP, verify OTP, maintain session.
- **Business Rules:** A `User` must have a verified phone number before being Active, except the intentional Staff-Assisted Booking exception already documented in `DOMAIN_MODEL.md`'s `User` invariants.
- **Dependencies:** `DOMAIN_MODEL.md` Identity Bounded Context.
- **Success Criteria:** Registration/login completes in seconds, not minutes; failure states (OTP not received) have a clear retry path.
- **Edge Cases:** OTP delivery failure (WhatsApp/SMS fallback — see Notifications module); a Staff-created Customer later self-registering with the same phone number (must reconcile to one `User`, not create a duplicate).

### Customer Management
- **Purpose:** Represent and manage the traveler booking services.
- **Capabilities:** Profile management; booking history; Staff-Assisted Booking creation.
- **User Actions:** Update profile/preferences; Staff can create a Customer record from a phone call.
- **Business Rules:** Per `DOMAIN_MODEL.md` Customer invariants — a `Customer` must exist before a `Booking` references them.
- **Dependencies:** Authentication & Identity, Booking module.
- **Success Criteria:** Staff can create a usable Customer record in well under a minute from just a phone number.
- **Edge Cases:** Customer later disputes a Staff-created Booking they don't recall — must be traceable via Audit Log to the responsible Staff member.

### Provider Management & Verification
- **Purpose:** Onboard and verify Service Providers, and manage their Drivers, Guides, Vehicles, and Assets.
- **Capabilities:** Provider application; Admin approval workflow; Driver/Guide/Vehicle/Asset registration under a Provider account.
- **User Actions:** Provider applies and submits verification documents (conceptually — no implementation detail here); Admin reviews and approves/rejects; Provider registers Drivers/Guides/Vehicles.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Provider cannot have a bookable Service/Experience before Approval; a Driver/Guide/Vehicle/Asset always belongs to exactly one Provider.
- **Dependencies:** Administration module (approval authority), Contracts module (a Provider needs an Active Contract before Approval, per `DOMAIN_MODEL.md` Contract invariant).
- **Success Criteria:** A legitimate Provider can complete application-to-Approved in a clear, bounded number of steps; an Admin can see exactly what they're approving.
- **Edge Cases:** A previously Approved Provider is later Suspended — all their active Bookings must be handled gracefully (existing confirmed Bookings honored or explicitly cancelled with Customer notification, not silently orphaned).

### Booking
- **Purpose:** Represent the commercial commitment between Customer and Provider.
- **Capabilities:** Booking creation (self-service or Staff-Assisted), confirmation, cancellation, Driver/Guide/Vehicle assignment.
- **User Actions:** Customer browses and books a Service/Experience; Staff creates a Booking on a Customer's behalf; Provider accepts/assigns a Driver/Guide/Vehicle.
- **Business Rules:** Per `DOMAIN_MODEL.md` Booking invariants — cannot confirm without an available Availability slot; Price and Commission are fixed at confirmation time.
- **Dependencies:** Customer Management, Provider Management, Pricing, Tracking (a confirmed Booking produces a Journey).
- **Success Criteria:** A Customer can complete a booking in a small number of steps; a Staff-Assisted Booking takes comparable time by phone.
- **Edge Cases:** Two Customers attempt to book the last available Availability slot simultaneously — one must be rejected/queued, not both silently confirmed; a Provider becomes unavailable after a Booking is Confirmed but before a Journey starts.

### Pricing & Commission
- **Purpose:** Represent Provider-Set Pricing and BARQ's commission.
- **Capabilities:** Provider sets/updates Price per Service/Experience; Commission calculated per Booking at confirmation.
- **User Actions:** Provider sets a Price; system calculates Commission automatically.
- **Business Rules:** Per `DOMAIN_MODEL.md` — only the Provider sets Price; every Provider has exactly one active Commission tier at a time. Full tier assignment/change rules owned by `PRICING_AND_COMMISSION.md` and `PRICING_STRATEGY.md` (not yet written) — not duplicated here.
- **Dependencies:** Provider Management (tier assignment is an Administration decision), Booking.
- **Success Criteria:** A Provider always knows, before confirming any Booking, exactly what they'll earn net of commission.
- **Edge Cases:** A Provider's Commission tier changes between a Booking's creation and its confirmation — the tier active at confirmation time governs, consistent with the Price/Commission fixed-at-confirmation invariant.

### Wallet & Payments
- **Purpose:** Represent money captured from Customers and owed to/held for Providers.
- **Capabilities:** Payment capture on Booking confirmation/completion; Wallet balance and Wallet Transaction ledger; Payout visibility.
- **User Actions:** Customer completes payment; Provider views Wallet balance and transaction history.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Wallet's balance always equals the sum of its immutable Wallet Transactions; a Payment's captured amount must equal the Booking's fixed Price.
- **Dependencies:** Booking, Pricing & Commission, Invoicing.
- **Success Criteria:** A Provider can always reconcile their Wallet balance against their own Booking history without discrepancy.
- **Edge Cases:** A Payment fails after a Booking is Confirmed — Booking state must reflect this without silently proceeding as if paid; a refund affecting a Wallet already partially paid out.

### Invoicing
- **Purpose:** Produce the legally formatted, bilingual transactional record of a billable Booking.
- **Capabilities:** Invoice generation on Booking completion, PDF output.
- **User Actions:** Customer/Provider retrieve their Invoice.
- **Business Rules:** Per `DOMAIN_MODEL.md` — Invoice numbering is sequential and gapless; never edited in place once issued.
- **Dependencies:** Booking, Wallet & Payments, Pricing & Commission.
- **Success Criteria:** Every completed Booking has a correctly numbered, bilingual Invoice available as a PDF.
- **Edge Cases:** A Booking is disputed/refunded after Invoice issuance — requires a Credit Note mechanism (per `DOMAIN_MODEL.md` Invoice lifecycle), not an edited original.

### Contracts
- **Purpose:** Represent legally binding agreements underpinning the Provider (and optionally Customer) relationship.
- **Capabilities:** Contract issuance and signature tracking, PDF output.
- **User Actions:** Provider reviews and signs a Contract as part of onboarding.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Provider cannot be Approved without an Active Contract.
- **Dependencies:** Provider Management & Verification.
- **Success Criteria:** No Provider reaches Approved status without a completed, signed Contract on file.
- **Edge Cases:** A Contract needs to change terms for an already-Active Provider — requires a superseding Contract, not an edit to the signed original.

### Notifications
- **Purpose:** Deliver timely, bilingual information to platform participants.
- **Capabilities:** WhatsApp as primary channel; notification composition tied to domain events (per `DOMAIN_MODEL.md` §3).
- **User Actions:** Recipients receive notifications; no direct user action to trigger them (system-driven from domain events).
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Notification's content must exist in both Arabic and English before sending.
- **Dependencies:** Every module producing a domain event (Booking, Payments, Provider Management, etc.).
- **Success Criteria:** A participant receives a relevant notification promptly after the triggering event, in their preferred language.
- **Edge Cases:** WhatsApp delivery failure — requires a defined fallback channel, per `ARCHITECTURE_PRINCIPLES.md` Principle 22 (Fail Gracefully); full fallback mechanics owned by future `NOTIFICATIONS.md`.

### Tracking
- **Purpose:** Represent live execution of a confirmed Booking.
- **Capabilities:** Journey start/progress/completion; live location sharing during an active Journey.
- **User Actions:** Customer views live location during an active Journey; Driver/Guide implicitly shares location during a Journey.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Journey cannot start before Booking confirmation and required assignment.
- **Dependencies:** Booking, Provider Management (Driver/Guide/Vehicle assignment).
- **Success Criteria:** A Customer can see accurate, timely location during an active Journey.
- **Edge Cases:** Location data loss mid-Journey (connectivity gap) — must degrade gracefully, not silently show stale data as if current.

### Ratings, Reviews & Trust Score
- **Purpose:** Capture Customer feedback and represent a basic Provider trust signal.
- **Capabilities:** Review/Rating submission post-completion; a basic Trust Score composite for V1 (see Open Questions on scope).
- **User Actions:** Customer submits a Review/Rating after a completed Booking.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Review can only be submitted for a Completed Booking.
- **Dependencies:** Booking.
- **Success Criteria:** Completed Bookings have a clear, low-friction path to leaving a Review.
- **Edge Cases:** A Customer attempts to review a cancelled or in-progress Booking — must be rejected per the invariant, with a clear reason shown.

### Support
- **Purpose:** Provide a path for Customers/Providers to raise and resolve issues.
- **Capabilities:** Support Ticket creation, Staff triage.
- **User Actions:** Customer/Provider opens a Support Ticket; Staff responds and resolves.
- **Business Rules:** Per `DOMAIN_MODEL.md` — a Support Ticket involving a refund cannot resolve without a corresponding financial outcome recorded.
- **Dependencies:** Booking (most tickets reference one), Wallet & Payments (for financial resolutions).
- **Success Criteria:** A Support Ticket reaches first Staff response within a defined, acceptable window (specific SLA owned by future `SOP_CUSTOMER_SUPPORT.md`).
- **Edge Cases:** A Support Ticket escalates into a formal Dispute — handoff mechanics owned by future `CUSTOMER_SUPPORT_AND_DISPUTES.md`.

### AI Assistant
- **Purpose:** Provide bilingual, assistive AI support to Customers (V1's minimum AI scope).
- **Capabilities:** Per `AI_STRATEGY.md` §3, Customer Assistant role only for V1 — information retrieval, booking guidance, support drafting.
- **User Actions:** Customer converses with the Assistant in Arabic or English.
- **Business Rules:** Fully governed by `AI_STRATEGY.md` §2 and §4 — no autonomous booking confirmation, payment, or business-rule invention.
- **Dependencies:** `AI_STRATEGY.md` (all sections), Knowledge Sources (§5 of that document).
- **Success Criteria:** The Assistant answers common Customer questions accurately in both languages and escalates to a human when it can't.
- **Edge Cases:** A Customer asks the Assistant something outside approved knowledge — it must say so, not invent an answer, per `AI_STRATEGY.md`'s "AI Never Invents" principle.

### Admin Dashboard (Administration)
- **Purpose:** Give Admins configuration and approval authority.
- **Capabilities:** Provider approval/suspension, Commission Tier policy configuration, Audit Log review.
- **User Actions:** Admin reviews Provider applications; Admin configures Commission policy.
- **Business Rules:** Per `DOMAIN_MODEL.md` — every configuration/approval action is Audit Logged.
- **Dependencies:** Provider Management, Pricing & Commission.
- **Success Criteria:** An Admin can complete a Provider approval decision with full visibility into what they're approving.
- **Edge Cases:** Two Admins attempt conflicting configuration changes near-simultaneously — must not silently apply both; requires a defined resolution (last-write visibility at minimum, full concurrency handling owned by later technical design).

### Operations Center (Operations)
- **Purpose:** Give Operations Agents/Staff real-time visibility.
- **Capabilities:** Live view of active Bookings/Journeys; Support Ticket visibility.
- **User Actions:** Operations Agent monitors active Journeys; responds to flagged issues.
- **Business Rules:** Per `DOMAIN_MODEL.md` Operations Bounded Context — observes Booking/Tracking data, doesn't own it.
- **Dependencies:** Booking, Tracking, Support.
- **Success Criteria:** An Operations Agent can identify an at-risk active Journey before a Customer complaint arrives.
- **Edge Cases:** A large volume of simultaneous active Journeys during a peak period — the view must remain usable, not just technically functional (specific performance targets owned by §8/NFRs).

## 8. Non-Functional Requirements

- **Performance:** Booking creation, Live Tracking updates, and Notification delivery are the platform's most latency-sensitive paths (per `ARCHITECTURE_PRINCIPLES.md` Principle 13) and must feel immediate to the user, even though specific numeric targets are owned by later technical design, not this document.
- **Availability:** Core booking and payment paths must be highly available; degraded/fallback behavior for third-party dependency failure is required per Principle 22, not optional resilience.
- **Accessibility:** Verified equally in Arabic/RTL and English/LTR per `ADR-0005` and `ARCHITECTURE_PRINCIPLES.md` Principle 14 — accessibility in only one language/direction does not satisfy this requirement.
- **Security:** Authentication, Wallet, and Payment paths receive the highest security scrutiny, per Principle 11 and `PROJECT_RULES.md` §16.
- **Privacy:** Data collection scoped to what each feature actually needs, per Principle 12; Oman PDPL implications owned by future `COMPLIANCE_AND_LEGAL.md`.
- **Scalability:** V1 operates a single market/tenant but must not architecturally preclude the multi-tenant expansion path already designed for, per Principle 21 and `BUSINESS_MODEL.md` §12.
- **Localization:** Full Arabic/English parity across every V1 feature, per `ADR-0005` — no feature ships in one language only.
- **Reliability:** Financial and booking data integrity (Wallet ledger immutability, Booking/Price fixation at confirmation) must hold under all normal and degraded conditions.
- **Maintainability:** Every V1 module maps cleanly to a `DOMAIN_MODEL.md` Bounded Context, per Clean Architecture and DDD principles (4–5), so the codebase mirrors the business rather than drifting from it.
- **AI Safety:** V1's AI Assistant operates entirely within `AI_STRATEGY.md` §2 and §4 — Human-in-the-Loop for anything consequential, approved-knowledge-only, no invented business rules.

## 9. User Journeys

- **Customer Journey:** Discover a Service/Experience → view verified Provider and transparent Price → book → receive bilingual confirmation via WhatsApp → track live during the Journey → receive Invoice → leave a Review.
- **Provider Journey:** Apply → submit Contract → get Approved → register Services/Experiences/Assets/Drivers/Guides and set Price → receive Bookings → fulfill via assigned Driver/Guide/Vehicle → see Wallet update after completion.
- **Staff Booking Journey:** Receive a phone call from a Customer → create/locate the Customer record by phone number → create a Booking on their behalf → confirm and notify the Customer via WhatsApp.
- **Admin Journey:** Review a pending Provider application and its Contract status → approve or reject → configure/confirm the Provider's Commission Tier → monitor via Audit Log.
- **Support Journey:** Customer/Provider opens a Support Ticket → Staff triages and responds → resolves, or escalates to a Dispute if financial consequence is involved.

## 10. Success Metrics

Product-level KPIs only (marketplace-level KPIs are owned by `BUSINESS_MODEL.md` §15; technical KPIs by future `KPIS.md`):

- Booking completion rate (started vs. confirmed vs. completed)
- Time-to-first-booking for a new Customer
- Staff-Assisted Booking completion time vs. self-service booking time
- Provider onboarding completion rate (applied vs. Approved)
- AI Assistant resolution rate without human escalation
- Feature-level Arabic/English parity (a binary pass/fail per feature, not a soft target — per `ADR-0005`)
- Support Ticket first-response time

## 11. Product Constraints

- **Budget:** Early-stage; architecture and feature scope must respect `ARCHITECTURE_PRINCIPLES.md` Principle 26 (Cost-Aware Architecture) — V1 scope is deliberately bounded partly for this reason.
- **Technology:** Modular Monolith per `ADR-0002`; no premature adoption of infrastructure V1's actual scale doesn't need.
- **Operations:** A single-market (Salalah) launch bounds Staff/Operations capacity assumptions for V1.
- **Legal:** Oman-specific compliance (PDPL, tourism licensing) constrains what Contracts/Invoicing must support at launch; full detail owned by future `COMPLIANCE_AND_LEGAL.md`.
- **AI:** Every AI capability in V1 is bounded by `AI_STRATEGY.md` §4 — this is a hard constraint on scope, not a suggestion.

## 12. Future Releases

- **V1:** As scoped in §5.
- **V1.5:** Likely candidates — expanded Trust Score sophistication, Support/Dispute workflow maturity, additional AI Roles beyond Customer Assistant (e.g. Provider Assistant) — not committed, subject to `ROADMAP.md`.
- **V2:** Candidate scope — Oman-wide expansion (per `BUSINESS_MODEL.md` §12), additional Provider categories (Hotels/Restaurants per `BUSINESS_MODEL.md` §9), enterprise/API revenue exploration.
- **V3:** Candidate scope — GCC expansion, multi-tenancy activation, native mobile apps.
- **Long-Term Vision:** As stated in `PROJECT_MANIFEST.md` §13 and elaborated in `BUSINESS_MODEL.md` §16 — referenced, not repeated.

## 13. Feature Prioritization (MoSCoW)

- **Must Have:** Authentication, Booking, Provider Verification, Pricing & Commission, Wallet, Invoicing, Contracts, WhatsApp Notifications, Tracking, Arabic/English full parity, basic AI Assistant, Admin Dashboard, Operations Center.
- **Should Have:** Ratings & Reviews, basic Trust Score, Support Ticket triage.
- **Could Have:** PDF Generation polish beyond minimum legal compliance (e.g. enhanced formatting), expanded AI Assistant capability within existing boundaries.
- **Won't Have (for now):** Everything listed in §6, Out of MVP.

## 14. Risks

- **Product Risks:** Scope creep pulling V1 past what a single-market launch actually needs to validate the model; underestimating how much Staff-Assisted Booking is actually used, and understaffing Operations as a result.
- **Operational Risks:** Provider Verification bottlenecking launch if approval throughput can't keep pace with applications.
- **Business Risks:** As detailed in `BUSINESS_MODEL.md` §14 — referenced, not repeated.
- **Technical Risks:** As detailed in `ARCHITECTURE_PRINCIPLES.md`-governed future architecture documents — referenced, not repeated here.

## 15. Acceptance Criteria

BARQ V1 is successful when: a Customer can discover, book, pay for, and track a real tourism Service or Experience from a Verified Provider entirely in their preferred language (Arabic or English, with full parity); a Provider can be onboarded, set their own Price, and get paid via Wallet without manual intervention beyond Admin approval; a Staff member can complete an equivalent booking by phone for a Customer who never opens the app; an Admin has full, audited visibility and control over Provider approval and Commission policy; and every one of these flows operates within the AI boundaries, bilingual requirements, and domain invariants already established in `AI_STRATEGY.md`, `ADR-0005`, and `DOMAIN_MODEL.md` — with no feature considered Done, per `PROJECT_RULES.md` §8, until it meets all of the above.

---

## Related Documents
- `PROJECT_MANIFEST.md` — Vision/Mission this document's Product Vision (§2) references
- `GLOSSARY.md` — canonical terminology used throughout
- `DOMAIN_MODEL.md` — every module in §7 maps to an existing Bounded Context/entity set, referenced not redefined
- `BUSINESS_MODEL.md` — §9 (Provider Acquisition), §10 (Trust Model), §12 (Scalability) inform personas, Trust Score scope, and the Salalah-first framing
- `ARCHITECTURE_PRINCIPLES.md` — Mobile First, Bilingual by Design, AI First, Cost-Aware Architecture principles underlying §5, §8, §11
- `AI_STRATEGY.md` — governs the AI Assistant module (§7) and AI Safety NFR (§8) in full
- `ADR-0002-modular-monolith.md`, `ADR-0005-bilingual-architecture.md` — architectural decisions this document's scope respects
- `PRICING_AND_COMMISSION.md`, `PRICING_STRATEGY.md`, `NOTIFICATIONS.md`, `CUSTOMER_SUPPORT_AND_DISPUTES.md`, `SOP_CUSTOMER_SUPPORT.md`, `COMPLIANCE_AND_LEGAL.md`, `ROADMAP.md`, `KPIS.md` *(all not yet written)* — each owns detail intentionally left unduplicated here

## Open Questions
1. Basic Trust Score (§5, §7) has no defined formula yet — even "basic" needs a stated minimum composition (e.g. verification status + completion rate) before implementation can begin. Should be resolved before this document reaches Approved, not deferred silently into implementation.
2. Should Tourism Company and Fleet Owner (§4) be modeled as distinct personas with different Provider Portal needs, or treated as the same persona at different scale? Currently written as distinct personas but with largely identical needs — flagging in case `PROVIDER_AND_STAFF_WORKFLOWS.md` finds a reason to differentiate them further.
3. §11's "Operations" constraint assumes Salalah-scale Staff capacity for V1 — at what booking volume does this assumption break, and who monitors that threshold? Not answered here; likely an operational readiness question for `SOP_BOOKINGS.md`.
4. This document's V1 AI Assistant scope (§7) is limited to the Customer Assistant role only — should a minimal Provider Assistant (e.g. just Wallet/commission explanation) be pulled into V1 given how central Provider trust is to `BUSINESS_MODEL.md` §7? Flagged rather than decided unilaterally.

## Future ADR References
- Any expansion of V1 AI scope beyond the Customer Assistant role, once this document is Locked, requires an ADR — not a quiet MVP scope-creep decision.
- Any decision to include Native Mobile Apps, Dynamic Pricing, or AI Dispatch before the release stage currently assigned to them in §12 requires an ADR, since each is explicitly named as Out of MVP in §6.
