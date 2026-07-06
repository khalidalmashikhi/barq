# BARQ Identity and Access

- **Purpose:** Define BARQ's identity and authorization architecture — roles, permissions, access rules, delegation, ownership, human accountability, and AI service identity. This document does not define authentication, implementation, or database schema.
- **Scope:** Authorization principles, identity types, role model, permission model (philosophy only), access boundaries, ownership rules, delegation, AI authorization, human accountability, approval workflows, administrative access, future RBAC evolution, access reviews, and security considerations.
- **Out of Scope:** Authentication mechanics (owned entirely by `AUTHENTICATION.md`, referenced not redefined), JWT, OAuth, API definitions, database schema, implementation of any kind.
- **Dependencies:** `AUTHENTICATION.md` (produces the verified identity this document decides what to do with), `ADR-0008-ai-agent-boundaries.md` (governs §9 in full), `DOMAIN_MODEL.md` (`User`, `Staff`, `Admin`, `Provider` entities and every Bounded Context's ownership already established there), `AI_AGENTS.md` (the agents whose service identities §9 governs), `SYSTEM_ARCHITECTURE.md` §6/§8/§12 (the Application Layer authorization boundary this document's rules are enforced through), `DATABASE_DESIGN.md` §9/§11 (Audit Log immutability and PII/least-privilege rules this document applies at the identity layer), `API_CONTRACTS.md` §10 (which this document now fulfills — flagged in Open Questions, not unilaterally revised here).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## 1. Executive Summary

`AUTHENTICATION.md` establishes *who someone is*; this document establishes *what they may do*. BARQ's authorization model is role-based, least-privilege by default, and treats every permission grant as something that must be justified against a real operational need — never granted speculatively "in case it's useful." Per `ADR-0008`, no AI Agent ever holds a permission a human must explicitly exercise; an AI Agent acts through its own distinct service identity (`AUTHENTICATION.md` §9), never through a human's session, and never escalates its own access. Every consequential action — human or AI-assisted — remains traceable to an accountable human, without exception (§10).

## 2. Authorization Principles

- **Least Privilege:** Every role (§4) is granted the minimum access its real function requires — access is expanded only when a genuine need is demonstrated, never by default.
- **Need to Know:** Access to a specific record, not just a general capability, is scoped to whether the identity genuinely needs that specific record — a Support Staff role having "ticket access" does not mean access to every ticket regardless of relevance.
- **Separation of Duties:** No single role holds both the ability to create a consequential action and unilaterally approve it for itself — e.g. the role that processes a refund is not the same role, acting alone, that approved it, wherever practical (§11).
- **Human Accountability:** Governed in full by §10 — every action traces to an accountable human, always.
- **AI Safety:** Governed in full by §9 — an AI Agent's authorization is structurally incapable of exceeding `ADR-0008`'s boundaries, not merely policy-restricted from doing so.
- **Role Simplicity:** As few roles as the business genuinely requires (§4) — a proliferation of narrow, overlapping roles is its own security and maintainability risk, consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 19 (Convention over Configuration) applied to access control.
- **Future Scalability:** The role model (§4) and ownership rules (§7) are designed not to preclude GCC expansion (`BUSINESS_MODEL.md` §12) or the future RBAC evolution named in §13 — but neither is built out prematurely for scale BARQ doesn't yet have, consistent with Cost-Aware Architecture.

## 3. Identity Types

- **Customer** — a traveler; per `DOMAIN_MODEL.md` Customer context.
- **Provider** — a Service Provider; per `DOMAIN_MODEL.md` Provider context.
- **Operations Staff** — a role assigned to a `Staff` account (`DOMAIN_MODEL.md`), scoped to real-time monitoring, dispatch support, and Staff-Assisted Booking.
- **Support Staff** — a role assigned to a `Staff` account, scoped to Support Ticket handling.
- **Finance Staff** — a role assigned to a `Staff` account, scoped to financial oversight and execution of human-approved financial actions (payouts, refunds).
- **Admin** — per `DOMAIN_MODEL.md` Administration context; configuration and approval authority.
- **System** — a non-human, non-AI technical identity for background jobs and scheduled tasks (e.g. a Notification dispatch worker) — distinct from both a human Staff/Admin identity and an AI Agent's service identity; a System identity has no discretionary decision-making capability of any kind.
- **AI Service Identity** — per `AUTHENTICATION.md` §9 and `ADR-0008` — every AI Agent (`AI_AGENTS.md`) authenticates and is authorized under its own distinct service identity, never a borrowed human session.
- **Partner (future)** — a future third-party integration identity (`API_CONTRACTS.md` §3's Future Partner API, `BUSINESS_MODEL.md` §6's API Access) — not part of V1, named here only so the identity model has a defined place for it when it becomes real.

**Note on Operations/Support/Finance Staff:** `DOMAIN_MODEL.md` defines one `Staff` entity, not three. Operations Staff, Support Staff, and Finance Staff are **roles** assigned to a `Staff` identity — an authorization-layer distinction, not a domain-entity distinction. This document does not propose adding three new entities to `DOMAIN_MODEL.md`; a single Staff member could plausibly hold more than one of these roles where the business genuinely requires it, subject to Separation of Duties (§2).

## 4. Role Model

- **Customer** — *Purpose:* book and receive tourism services. *Responsibilities:* manage own profile, Bookings, Reviews. *Limitations:* no access to any other Customer's data; no administrative capability of any kind. *Ownership:* own profile, own Booking history, own Reviews (§7).
- **Provider** — *Purpose:* operate a tourism business on BARQ. *Responsibilities:* manage own Services/Experiences, Availability, Drivers/Guides/Vehicles/Assets, and pricing within Commission rules. *Limitations:* no access to any other Provider's data; cannot self-approve (`DOMAIN_MODEL.md` Provider invariant); cannot change its own Commission tier. *Ownership:* own Services/Experiences/Availability/Assets/Drivers/Guides, own Wallet (view).
- **Operations Staff** — *Purpose:* real-time platform operation. *Responsibilities:* Staff-Assisted Booking creation, active Journey/Booking monitoring, operational dispatch support (never autonomous, and never AI-executed either, per `AI_AGENTS.md` §6). *Limitations:* cannot approve Providers, cannot change Commission policy, cannot access financial configuration beyond what monitoring requires. *Ownership:* none — acts on Customer/Booking/Journey data within Operations' observation scope (`DOMAIN_MODEL.md` §1), every action attributed to the individual Staff member.
- **Support Staff** — *Purpose:* handle Support Tickets. *Responsibilities:* triage, respond, escalate Disputes. *Limitations:* refund/credit authority, if any, is bounded (§11, §17) — not unlimited by virtue of handling the ticket. *Ownership:* none — acts on Support Ticket data, attributed to the individual.
- **Finance Staff** — *Purpose:* financial oversight and execution of human-approved financial actions. *Responsibilities:* reconcile Wallet issues, execute approved Payouts/Refunds (`ADR-0008` points 5–6 govern that this is a human action — Finance Staff is the human), review financial anomalies. *Limitations:* cannot change Commission tier *policy* (an Admin configuration decision, `DOMAIN_MODEL.md` Admin invariant) — Finance Staff executes within existing policy, it does not set policy. *Ownership:* none — acts on Payment/Wallet/Invoice data, attributed to the individual.
- **Admin** — *Purpose:* platform configuration and approval authority. *Responsibilities:* Provider Approval/Suspension, Commission tier policy, platform configuration, Staff account provisioning. *Limitations:* bound by the same Audit Log immutability as every other role (`DATABASE_DESIGN.md` §9) — Admin authority is broad, not unaccountable; an Admin cannot delete an Audit record any more than any other role can (§16). *Ownership:* Administration context data (`DOMAIN_MODEL.md`); holds approval authority over Provider and Commission, but does not "own" those records in the operational sense §7 describes.
- **System** — *Purpose:* execute defined technical operations (background/scheduled jobs). *Responsibilities:* the specific technical function it's deployed for, nothing broader. *Limitations:* tightly scoped, least-privilege by design; no discretionary capability — a System identity either does its one job or fails, it never makes a judgment call. *Ownership:* none, ever — a technical actor, not a business owner.
- **AI Service Identity** — *Purpose:* per each agent's role in `AI_AGENTS.md` §4–§10. *Responsibilities:* exactly what its governing specification states, nothing more. *Limitations:* governed in full by §9 and `ADR-0008`. *Ownership:* none, ever, per `ADR-0008` point 1.

## 5. Permission Model

Philosophy only — no implementation:

- **View:** Read access scoped by ownership (§7) or role scope (§6) — never a general "see everything" default for any role, including Admin, whose broad authority is still scoped to what Administration genuinely needs to see.
- **Create:** The ability to originate a new record within one's own scope — a Customer creates their own Booking; Staff creates a Booking on a Customer's behalf (Staff-Assisted Booking, attributed to Staff); a Provider creates their own Service.
- **Update:** Modification of an owned record, always bounded by the domain invariants already established in `DOMAIN_MODEL.md` — e.g. no role, however privileged, can "Update" a `Booking`'s `Price` after confirmation, because that invariant is a domain rule, not a permission gap.
- **Approve / Reject:** Reserved for roles explicitly authorized for a specific workflow (§11) — never a default capability of "being staff" — and never granted to an AI Service Identity under any circumstance (`ADR-0008` point 12).
- **Delete:** In practice, almost never a true hard-delete for financial, legal, or audit-relevant data (`DATABASE_DESIGN.md` §18) — "Delete" as a permission typically means soft-delete/deactivation within the bounds §5 of that document already established; no role's permission model overrides that.
- **Export:** Tightly scoped given PII considerations (`DATABASE_DESIGN.md` §11) — export capability is not a byproduct of View access; it is its own, more restrictively granted permission, typically limited to Admin or a specifically justified reporting need.
- **Audit:** Read-only visibility into Audit Logs — never modification capability for anyone, including Admin, consistent with immutability (`DATABASE_DESIGN.md` §9).
- **Impersonate (if allowed):** A distinct, exceptional, high-risk permission — explicitly **not** the same thing as Staff-Assisted Booking (which is Staff acting as themselves, attributed to themselves, never "as" the Customer). True impersonation (e.g. an Admin viewing the platform as a specific Customer for support/debugging) is granted narrowly, time-boxed, and produces its own dedicated Audit Log entry every time it is used, per §16's anti-pattern against impersonation without audit.

## 6. Access Boundaries

- **Customer:** Own data only (§7) — no visibility into another Customer's, Provider's, or Staff member's data.
- **Provider:** Own business data only — no visibility into another Provider's listings, Bookings, or Wallet.
- **Staff (Operations/Support/Finance):** Scoped to the operational data their role requires (§4) — never platform-wide configuration authority, which remains Admin-exclusive.
- **Admin:** The broadest human access boundary on the platform, still scoped to Administration's genuine configuration/approval function (§4) — not an unscoped "root" account in practice, even though it is the most privileged role.
- **AI:** Scoped per-agent to exactly what `AI_AGENTS.md` §4–§10 documents as that agent's Inputs — never a general AI-wide data access boundary; each agent's boundary is independently defined and independently enforced.
- **System:** Scoped to the specific technical job it performs — the narrowest access boundary on the platform, by design.

## 7. Ownership Rules

"Owns" here means access-layer ownership (who has rights over a specific instance) — distinct from `DOMAIN_MODEL.md`'s Bounded Context ownership (which module's domain logic governs the entity's business rules). Both can be true simultaneously without conflict.

- **Bookings:** Customer owns their own (view/cancel within rules); Provider owns the fulfillment side of their own; Staff acts within the Staff-Assisted Booking scope, attributed to them; Admin holds oversight/audit access; AI never owns a Booking, only reads within its agent-specific scope.
- **Vehicles:** Owned by the registering Provider.
- **Services:** Owned by the listing Provider.
- **Contracts:** Owned by the Provider or Customer party to it; Admin holds issuance/oversight access.
- **Invoices:** Owned by the Customer/Provider party the Invoice concerns; Finance Staff and Admin hold oversight access.
- **Wallet:** "Owned" here means whose funds/record it is (Provider or Customer) — no role, including the owning Provider/Customer themselves, can directly modify a Wallet balance; it is always derived from immutable Wallet Transactions (`DOMAIN_MODEL.md`). Finance Staff and Admin hold reconciliation/oversight access, not direct edit rights.
- **Tracking:** Customer and Provider own view access during their own active Journey; Operations Staff and Admin hold oversight access.
- **Support:** Owned by the Customer or Provider who raised the ticket; Support Staff owns the handling of it; Admin holds escalation oversight.
- **Reports:** Owned by Admin, Finance Staff, and Operations Staff within their respective domains at the platform level — Customers and Providers do not have platform-level report access, though a Provider's own performance summary (`AI_AGENTS.md` §5's Provider Assistant "Performance insights") is a Provider-owned view of their own data, not a platform Report in this section's sense.

## 8. Delegation

- **Temporary Delegation:** A role's specific, bounded capability can be temporarily assigned to another qualified identity (e.g. an Admin delegating a specific approval task while unavailable) — never a blanket delegation of the entire role.
- **Approval Delegation:** Specifically for workflows in §11 — a delegated approver must independently satisfy whatever qualification the original role required; delegation does not lower the bar.
- **Revocation:** Every delegation is revocable immediately, by the delegator or by Admin, without requiring the delegate's cooperation.
- **Audit:** Every delegation grant and revocation is Audit Logged — who delegated what, to whom, for how long, and when it ended (or was ended).

## 9. AI Authorization

Fully governed by `ADR-0008-ai-agent-boundaries.md`, referenced here, not redefined:

- **AI never owns permissions.** An AI Service Identity's access is a fixed, narrowly-scoped grant defined by its governing specification (`AI_AGENTS.md`) — it does not accumulate, request, or hold discretionary permission the way a human role might grow into over time.
- **AI acts through service identity.** Per `AUTHENTICATION.md` §9 — every AI Agent's access is exercised under its own distinct identity, never a human's session, so its actions are independently auditable rather than indistinguishable from the human it assists.
- **AI never escalates itself.** No AI Agent can grant itself additional permission scope, approve its own request for expanded access, or otherwise move itself up this document's role model — any expansion of an agent's authorized scope is a human decision, recorded at the same rigor as any other permission change (§14), and any expansion touching `ADR-0008`'s boundaries requires a superseding ADR, not a routine access change.

## 10. Human Accountability

Every action on BARQ belongs to an accountable human — without exception:

- A Customer or Provider's own action is accountable to themselves.
- A Staff-Assisted action is accountable to the specific Staff member who performed it (`DOMAIN_MODEL.md`'s Audit Log requirement).
- An AI-assisted action is accountable to the human who used, approved, or acted on the AI Agent's output — the AI Agent itself is never the accountable party, because it is not a legal or moral agent capable of bearing accountability; per `ADR-0008` point 17, a human always retains final authority, and that human is who accountability attaches to.
- A System identity's action is accountable to whoever authorized the deployment/configuration that defined its behavior — traceable through the engineering change-review process (`PROJECT_RULES.md` §14), not to a per-action human decision in the moment, since a System identity has no discretionary judgment to hold accountable for.

**AI assistance never removes accountability** — this is the single sentence every other rule in this document exists to make true in practice, not just in principle.

## 11. Approval Workflows

- **Provider Approval:** Admin only, per `DOMAIN_MODEL.md` Provider lifecycle and `ADR-0008` point 7 — no exception, no delegation to a non-Admin role, no AI involvement beyond recommendation (`AI_AGENTS.md` §9's Admin Assistant).
- **Refund Approval:** A human role (Finance Staff or Support Staff within a bounded authority, escalating to Admin above a threshold) — specific authority limits are an Open Decision (§17), not invented here; the requirement is that a human, in a role with genuine financial accountability, approves every refund, per `ADR-0008` point 12.
- **Dispute Resolution:** Support Staff for standard cases, escalating to Admin for higher-severity or higher-value Disputes — exact escalation criteria deferred (§17).
- **Manual Override:** Admin only, tightly audited, connected to §12's Break Glass procedure where the override is an emergency action.
- **Configuration Changes:** Admin only, per `DOMAIN_MODEL.md` Admin invariant — Finance Staff executes within policy (§4) but does not set it.

## 12. Administrative Access

- **Break Glass:** A defined emergency-access procedure for genuinely exceptional circumstances (e.g. resolving a critical incident that normal role boundaries would otherwise block or dangerously delay) — used rarely, and its use is itself the trigger for mandatory post-hoc review (§14).
- **Emergency Access:** Time-boxed, automatically expiring elevated access granted only when a Break Glass justification is recorded at the time of use, not retroactively.
- **Temporary Elevation:** A role temporarily granted an additional, specific permission for a bounded task — distinct from Break Glass in that it's planned rather than emergency-triggered, but held to the same audit standard.
- **Audit:** Every Break Glass, Emergency Access, or Temporary Elevation event is Audit Logged without exception and reviewed after the fact (§14) — this category of access is the highest-scrutiny category in the entire permission model, precisely because it exists to bypass normal boundaries when genuinely necessary.

## 13. Future RBAC Evolution

Directional only, none committed for V1:

- **Attribute-Based Access (ABAC):** A candidate future refinement once role-based rules alone become insufficient for nuanced scenarios — e.g. GCC multi-country expansion (`BUSINESS_MODEL.md` §12) introducing location or market attributes that affect access in ways a pure role model doesn't cleanly express.
- **Policy-Based Access:** A candidate future centralized policy engine, if/when the number of roles and rules grows enough to justify one — not justified at V1's scale (Role Simplicity, §2).
- **Enterprise Access:** A candidate future access model for Enterprise/Tourism Company partners (`BUSINESS_MODEL.md` §6), contingent on that revenue category actually being pursued.
- **Partner Access:** Per §3's Partner identity type — contingent on a real Partner API integration existing.

## 14. Access Reviews

- **Periodic Review:** A regular, recurring review of who holds which role — exact cadence is an Open Decision (§17).
- **Role Audit:** Verifies role assignments still match the actual, current job function of each identity — catching role drift (someone still holding access their current responsibilities no longer require).
- **Permission Audit:** Verifies that what a role actually grants still matches what this document defines — catching implementation drift from the documented model, not just assignment drift.
- **Dormant Accounts:** Accounts unused for an extended period are flagged and, per policy, deactivated — exact threshold is an Open Decision (§17), not invented here.

## 15. Security Considerations

- **Privilege Escalation:** Guarded against structurally (Least Privilege, §2) and procedurally (§14's reviews) — a role gaining capability gradually through undocumented exceptions is treated as a defect to fix immediately, not a tolerance to manage.
- **Lateral Movement:** A compromised low-privilege identity must not be able to reach high-privilege capability through an indirect path — Access Boundaries (§6) are designed to hold even under the assumption that one boundary has already been breached, not only under normal operating conditions.
- **Insider Threats:** Staff and Admin accounts are subject to the same Audit Log scrutiny as any other actor — internal trust is not blind trust, consistent with `PROJECT_MANIFEST.md`'s "trust is the product" applied internally as much as externally.
- **Least Privilege:** Restated here specifically as an ongoing security control, not only a design-time principle (§2) — it is enforced operationally through §14's recurring reviews, not asserted once and assumed to hold forever.

## 16. Anti-Patterns

Explicitly forbidden, without exception:

- Never share accounts — every action must be attributable to exactly one identity (§10); a shared account destroys that traceability by design.
- Never grant permanent admin — where elevated access is genuinely needed beyond a role's normal scope, it is Temporary Elevation (§12), audited and time-boxed, not a standing grant.
- Never bypass approval — every workflow in §11 is followed in full; urgency is addressed through Break Glass (§12), which is itself audited, not through skipping the approval step quietly.
- Never impersonate without audit — per §5's Impersonate permission philosophy; every use is logged, without exception.
- Never give AI human authority — per §9 and `ADR-0008` in full; this is the anti-pattern this entire document is most structurally built to prevent.

## 17. Open Decisions

Intentionally deferred — not invented here:

1. **Specific refund/Dispute approval authority thresholds** (§11) — which amounts/severities Support Staff or Finance Staff can approve directly versus must escalate to Admin.
2. **Break Glass procedure mechanics** (§12) — the specific trigger conditions and technical mechanism, beyond the audit requirement already stated.
3. **Access review cadence** (§14) — how often Periodic Review, Role Audit, and Permission Audit actually occur.
4. **Dormant account threshold** (§14) — how long unused before an account is flagged/deactivated.
5. **ABAC/Policy-Based Access adoption timing** (§13) — contingent on real scale/complexity needs not yet present.
6. **Partner Access model timing** (§13) — contingent on a real Partner API integration.
7. **Whether Operations/Support/Finance Staff should eventually become formally distinct account types rather than roles on a shared `Staff` identity** (§3) — flagged as a possible future `DOMAIN_MODEL.md` question, not decided here.

---

## Related Documents
- `AUTHENTICATION.md` — produces the verified identity this document authorizes; §9 here is built directly on that document's §9
- `ADR-0008-ai-agent-boundaries.md` — the permanent governance §9 complies with in full
- `DOMAIN_MODEL.md` — `User`, `Staff`, `Admin`, `Provider` entities and every Bounded Context's domain ownership, distinct from but consistent with this document's access-layer ownership (§7)
- `AI_AGENTS.md` — the agents whose service identities and scoped permissions §4/§9 reference
- `SYSTEM_ARCHITECTURE.md` §6, §8, §12 — the Application Layer authorization boundary this document's rules are enforced through
- `DATABASE_DESIGN.md` §9, §11 — Audit Log immutability and PII/least-privilege rules applied here at the identity layer
- `API_CONTRACTS.md` §10 — states it would be revisited once this document existed; see Open Questions, not actioned here

## Open Questions
1. `API_CONTRACTS.md` §10 explicitly deferred to this document — should that section now be revised for consistency, or is a one-way reference sufficient? Flagged, not actioned — consistent with holding this question open rather than resolving it unilaterally, per the process correction noted in the previous turn's `AUTHENTICATION.md`/`TECH_STACK.md` sequence.
2. Should the Provider role (§4) eventually be split into sub-roles (e.g. a Fleet Owner managing multiple Drivers vs. an independent Driver-Provider) given `BUSINESS_MODEL.md` §9's Provider breadth, or does the current single Provider role with Driver/Guide/Vehicle/Asset sub-entities (`DOMAIN_MODEL.md`) already handle this adequately at the access layer? Flagged for `PROVIDER_AND_STAFF_WORKFLOWS.md` when written, not decided here.

## Future ADR References
- Any future expansion of an AI Service Identity's permission scope beyond what `AI_AGENTS.md` currently documents requires a superseding ADR to `ADR-0008`, not a routine access change (§9).
- Any decision to formally split Operations/Support/Finance Staff into distinct account types (Open Decision #7) would be a `DOMAIN_MODEL.md`-level change and should be recorded as an ADR if adopted.
- Any adoption of ABAC or Policy-Based Access (§13) as a committed direction, not merely a future possibility, requires an ADR given how substantially it would change this document's core role-based model.
