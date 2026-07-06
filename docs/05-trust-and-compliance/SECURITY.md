# BARQ Security

- **Purpose:** Define BARQ's security architecture — security principles, governance, trust boundaries, and operational security requirements. This document does not define implementation, encryption algorithms, cloud vendor configuration, firewall rules, or code.
- **Scope:** Security principles, trust boundaries, identity security, data protection (including the entity classification `DATABASE_DESIGN.md` §11 deferred here), API security, AI security, operational security, infrastructure security, monitoring, incident management, vendor security, compliance philosophy, and future security practice.
- **Out of Scope:** Specific encryption algorithms, cloud vendor configuration, firewall rules, implementation, code. Full legal/regulatory compliance detail (owned by future `COMPLIANCE_AND_LEGAL.md`, referenced not anticipated in detail).
- **Dependencies:** `PROJECT_MANIFEST.md` (trust as the actual product), `ARCHITECTURE_PRINCIPLES.md` Principles 11–12 (Security by Design, Privacy by Design), `AUTHENTICATION.md` (identity verification, referenced not redefined), `IDENTITY_AND_ACCESS.md` (authorization model, referenced not redefined), `ADR-0008-ai-agent-boundaries.md` (governs §7 in full), `DATABASE_DESIGN.md` §9/§11 (Audit Log immutability and the PII/data-classification requirement this document now fulfills), `API_CONTRACTS.md` §15 (API-level security controls, elaborated not restated), `TECH_STACK.md` §16 (security tooling, elaborated not restated), `PROJECT_RULES.md` §16 (binding minimums this document now supersedes with full detail).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect / Security Lead (BARQ core team).

---

## A Note on What This Document Closes

Several prior documents explicitly deferred security detail to "future `SECURITY.md`" — `DATABASE_DESIGN.md` §11's full data classification exercise, `PROJECT_RULES.md` §16's binding minimums, `API_CONTRACTS.md` §15's security section, `TECH_STACK.md` §16's tooling requirements, `AUTHENTICATION.md` §8's security controls, and `IDENTITY_AND_ACCESS.md` §15's security considerations. This document is that document. Where it resolves something those documents left open (most notably data classification, §5), it says so explicitly. Where it doesn't — vendor-specific configuration, exact key rotation cadence, penetration testing scheduling — it says that too, in §16, rather than inventing an answer to look complete.

---

## 1. Executive Summary

`PROJECT_MANIFEST.md` states that trust is the actual product, not a marketing claim. Security is the concrete, technical form that commitment takes. Per `ARCHITECTURE_PRINCIPLES.md` Principles 11–12, security and privacy are design-time inputs, not launch-week additions. `AUTHENTICATION.md` establishes who someone is; `IDENTITY_AND_ACCESS.md` establishes what they may do; `ADR-0008` establishes what an AI Agent may never do regardless of how convincingly it's asked. This document is where those three already-governed layers meet the rest of the platform's security surface: data at rest, APIs in transit, third-party vendors in the Integration Layer, and the operational discipline (secrets, monitoring, incident response) that keeps all of it trustworthy in practice, not just on paper.

## 2. Security Principles

- **Security by Design:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 11 — every feature's security implications are considered before implementation, never audited in afterward.
- **Least Privilege:** Per `IDENTITY_AND_ACCESS.md` §2 — restated here as a security control, not only an access-model principle: every credential, service account, and role holds the minimum access its function requires.
- **Defense in Depth:** No single control is the only thing standing between a request and a bad outcome — API-layer validation, Application-layer authorization, database-level constraints, and Audit Logging (§10) each independently reduce risk, so a failure in one layer doesn't mean a total failure.
- **Zero Trust Mindset:** No request is trusted by default merely because of where it originated — this applies to internal service-to-service calls (`ADR-0006`'s cross-module access rule) exactly as much as to external client requests; internal does not mean automatically trusted.
- **Privacy by Design:** Per Principle 12 — data collection is scoped to genuine need (§5's Data Minimization) as a security property, not only a compliance one; less collected sensitive data is less exposure risk by construction.
- **Auditability:** Per `DATABASE_DESIGN.md` §9 — every security-relevant action produces an immutable record (§10), so a security question can always be answered from evidence, not memory.
- **Secure Defaults:** Every new feature or configuration starts in its most restrictive viable state; access is opened deliberately, never defaulted to open for convenience and narrowed later.
- **Human Accountability:** Per `IDENTITY_AND_ACCESS.md` §10 — every security-relevant action, human or AI-assisted, traces to an accountable human; restated here because it is as much a security property as a governance one.

## 3. Trust Boundaries

- **Client:** Never trusted. Every input is validated server-side regardless of any client-side validation already performed — per §15's absolute anti-pattern against trusting client input.
- **API:** The primary external enforcement boundary — authentication (`AUTHENTICATION.md`), authorization (`IDENTITY_AND_ACCESS.md`), and rate limiting (§6) all apply here, before a request reaches business logic.
- **Application:** The Domain Layer (`SYSTEM_ARCHITECTURE.md` §4) trusts only validated input that has already crossed the API/Application boundary — it is never the layer responsible for first-line input validation.
- **Database:** Accessed only through module-scoped, least-privilege credentials (`ADR-0006`'s cross-module access rule) — even a compromised application component should not thereby gain unrestricted database access.
- **AI Layer:** Treated as a boundary that processes untrusted input by nature — a user's message to an AI Agent is data the agent reasons over, never an instruction the agent executes merely because it was asked confidently (§7).
- **Third-Party Services:** Isolated behind the Integration Layer (`SYSTEM_ARCHITECTURE.md` §4, §13) — a vendor is never trusted with more data or access than its specific function requires, and a vendor compromise or outage is designed to degrade gracefully (`ARCHITECTURE_PRINCIPLES.md` Principle 22) rather than cascade.
- **Admin Console:** The highest-privilege human boundary on the platform (`IDENTITY_AND_ACCESS.md` §4), and correspondingly the highest-scrutiny one — whether Admin authentication should exceed the platform's base OTP flow is flagged in §16, not assumed either way here.
- **Operations Center:** A real-time, read-heavy boundary (`SYSTEM_ARCHITECTURE.md` §5) — high visibility into live data does not imply a lighter authorization bar; the same boundary rules apply as anywhere else.

## 4. Identity Security

- **Authentication:** Fully owned by `AUTHENTICATION.md` — referenced, not redefined.
- **Authorization:** Fully owned by `IDENTITY_AND_ACCESS.md` — referenced, not redefined.
- **Service Identity:** Per `IDENTITY_AND_ACCESS.md` §3's System identity — scoped tightly to its specific technical job, the narrowest access boundary on the platform by design.
- **AI Identity:** Per `AUTHENTICATION.md` §9, `IDENTITY_AND_ACCESS.md` §9, and `ADR-0008` — every AI Agent holds its own distinct service identity, never a borrowed human session, so its actions are independently auditable.
- **Session Protection:** Sessions (`AUTHENTICATION.md` §5) are protected against theft, fixation, and hijacking as a matter of architectural requirement — tokens are never exposed in a URL (§15), and session state is treated with the same seriousness as any other credential.

## 5. Data Protection

**Data Classification — resolving `DATABASE_DESIGN.md` §11's deferred exercise:**

- **Public:** Data meant to be seen by anyone — published `Service`/`Experience` listings, public Provider profile content.
- **Internal:** Operational data not meant for public view but not independently sensitive — Activity Logs, Availability schedules, routine configuration.
- **Confidential:** Personally identifying or business-sensitive data — phone numbers, `Customer`/`Provider`/`Staff`/`Admin` identity fields, Wallet balances, Commission tier assignments.
- **Restricted:** The highest-sensitivity category — Audit Log contents, Wallet Transaction ledger detail, and anything that would be a severe trust or legal failure if exposed. Payment credential/instrument details are never stored by BARQ at all (`PROJECT_RULES.md` §16) — there is no "Restricted" tier for something the platform simply never holds.

Every entity in `DATABASE_DESIGN.md` §5 falls into one of these four tiers; a future revision of that document should annotate each entity accordingly, closing the loop this document opens (flagged in Open Questions, not actioned here).

- **Encryption Philosophy:** Confidential and Restricted data are encrypted at rest and in transit, as a category-level requirement — specific algorithms are Out of Scope, per instruction.
- **Data Minimization:** Only what a feature genuinely needs is collected — Authentication needs a phone number, nothing more, per `AUTHENTICATION.md` §2's Privacy by Design principle already applied there; this document extends the same discipline to every other feature.
- **Sensitive Data Handling:** Confidential/Restricted fields are masked in non-production environments and in any logging/observability output (`DATABASE_DESIGN.md` §11), without exception.
- **Retention:** Per each entity's retention policy (`DATABASE_DESIGN.md` §5) — shorter retention where legally and operationally possible reduces exposure risk, tying Cost-Aware Architecture and security together rather than treating them as competing concerns.
- **Deletion:** Soft-delete and hard-delete rules already established in `DATABASE_DESIGN.md` §15/§18 are restated here with a flagged tension: financial and Audit records are never hard-deleted, but a person's legitimate right-to-deletion request (where applicable under future privacy regulation) may conflict with that immutability requirement. This tension is not resolved in this document — it's named explicitly in §16 rather than quietly assumed away.

## 6. API Security

- **Authentication / Authorization:** Per `API_CONTRACTS.md` §9–§10, `AUTHENTICATION.md`, `IDENTITY_AND_ACCESS.md` — referenced, not redefined.
- **Rate Limiting:** Per `API_CONTRACTS.md` §15 — restated here specifically as a security control against brute-force and abuse, particularly on OTP-related endpoints (`AUTHENTICATION.md` §8).
- **Replay Protection:** Per `API_CONTRACTS.md` §15 and `AUTHENTICATION.md` §8 — a captured, replayed request (especially an OTP verification) must never succeed a second time.
- **Input Validation / Output Validation:** Per `API_CONTRACTS.md` §7, §15, §18 — the API boundary never trusts client input (§15) and never returns more than the caller is authorized to see, treating output shaping as a security control in its own right.
- **Idempotency:** Per `API_CONTRACTS.md` §5 — restated here as security-relevant, not only correctness-relevant: idempotency keys prevent a replayed or retried request from double-charging a Payment or double-confirming a Booking, which is as much a security property as a data-integrity one.

## 7. AI Security

Fully governed by `ADR-0008-ai-agent-boundaries.md`, referenced here, not redefined:

- **Prompt Injection Awareness:** Per `AI_STRATEGY.md` §8 — every AI Agent treats content it processes (a user's message, a document, external content) as data to reason over, never as an instruction to execute merely because it appears authoritative or urgent within that content.
- **Model Abuse:** A user attempting to manipulate an AI Agent into acting outside its documented Allowed Actions (`AI_AGENTS.md` §4–§10) is defended against architecturally — by the permission boundary enforced at the Application Layer (`ADR-0008` points 3–4) — never by trusting the model's own judgment about whether a request is legitimate.
- **Tool Abuse:** Any future tool-use capability an AI Agent gains (e.g. a future MCP integration, `TECH_STACK.md` §11) is scoped to exactly the same permissions as the agent's own service identity (§4) — a tool never grants an agent broader access than the agent itself is authorized for.
- **Hallucination Risk:** Per `AI_STRATEGY.md` §8 and `AI_AGENTS.md` §14, §17 — treated here specifically as a security-relevant risk where hallucinated content could mislead a security- or trust-relevant decision, not only as a quality metric to optimize over time.
- **Human Approval:** Per `ADR-0008` point 12 — restated here as a security control: the categories requiring human approval (Money, Contracts, Provider approval, Refunds, Disputes, Manual overrides, Configuration changes) are exactly the categories where an AI error would otherwise become a security or trust incident.
- **Service Identity:** Per §4 above — every AI Agent's actions are independently attributable, which is what makes AI-related security incidents investigable at all (§11).

## 8. Operational Security

- **Secrets:** Never committed to any repository, per `PROJECT_RULES.md` §16 — managed exclusively through the hosting platform's secret management (`TECH_STACK.md` §16).
- **Environment Variables:** Used for environment-specific configuration, never for storing a secret in a way that risks it being logged or exposed client-side by accident (`TECH_STACK.md` §16) — restated here as a security-critical distinction, not just a configuration convention.
- **Key Rotation:** API keys and service credentials are rotated periodically — exact cadence is an Open Decision (§16), not invented here; the requirement that rotation happens on a defined schedule, rather than only reactively after a suspected compromise, is stated now.
- **Backups:** Per `DATABASE_DESIGN.md` §14 — restated with the security-specific requirement that backups are encrypted and access-controlled to the same standard as the live data they contain, never a weaker, less-protected copy of Confidential/Restricted data.
- **Recovery:** Per `DATABASE_DESIGN.md` §14 — the recovery process itself is audited and access-controlled; a disaster-recovery path is never an unaudited backdoor around normal access controls.
- **Incident Response:** Governed in full by §11.

## 9. Infrastructure Security

- **Hosting:** Per `TECH_STACK.md` §15, `ADR-0007` — BARQ operates under a shared-responsibility model with its hosting platform: infrastructure-level security is the platform's responsibility, application-level security (everything in this document) remains BARQ's own.
- **Network Boundaries:** Internal services are not exposed beyond what the Integration Layer (`SYSTEM_ARCHITECTURE.md` §4) explicitly intends — no incidental network exposure of internal-only capability.
- **Database Isolation:** Per `ADR-0006`'s cross-module access rule and §3 above — module-scoped, least-privilege database credentials, not a single shared, broadly-privileged connection.
- **Storage:** Object Storage (`ADR-0006`, `TECH_STACK.md` §7) access is controlled — Invoice/Contract PDFs and any other stored file are served through access-controlled, time-limited references, never as permanently public files reachable by anyone who guesses or obtains a URL.
- **Logging:** Per `DATABASE_DESIGN.md` §9's Activity/Audit Log separation — logs themselves never contain unmasked Confidential/Restricted data (§5), since a log is itself a data store subject to the same classification rules as anything else.
- **Monitoring:** Governed in full by §10.

## 10. Monitoring

- **Security Logs:** A distinct category of logged event — authentication failures, authorization denials, rate-limit triggers — specifically feeding the alerting described below, distinct from routine Activity Logs.
- **Audit Logs:** Per `DATABASE_DESIGN.md` §9 — referenced, not restated.
- **Activity Logs:** Per `DATABASE_DESIGN.md` §9 — referenced, not restated.
- **Alerts:** Defined thresholds (e.g. repeated failed OTP attempts, an unusual pattern of Admin configuration changes) trigger human notification — specific thresholds are an Open Decision (§16), not invented here.
- **Traceability:** Per `API_CONTRACTS.md` §5, §16 — every security-relevant event is traceable end-to-end via Correlation/Trace IDs, so an investigation (§11) never depends on incomplete or disconnected evidence.

## 11. Incident Management

- **Detection:** Via §10's monitoring and alerting — an incident is identified as early as the defined thresholds allow, not discovered externally first.
- **Containment:** Immediate session revocation and account suspension capability (`AUTHENTICATION.md` §5, `IDENTITY_AND_ACCESS.md` §12's Break Glass) are the primary containment tools — available and rehearsed, not theoretical.
- **Investigation:** Driven by immutable Audit Log evidence (`DATABASE_DESIGN.md` §9) — investigation is reliable specifically because that evidence cannot have been altered after the fact, including by whoever might be under investigation.
- **Recovery:** Informed by §8's Backup/Recovery capability — restoring normal operation without reintroducing the same vulnerability.
- **Lessons Learned:** Every real incident feeds back into a future revision of this document — a security architecture that never updates after a real incident isn't actually learning from experience.

## 12. Vendor Security

- **Maps (Google Maps Platform):** Accessed exclusively through the Integration Layer (`TECH_STACK.md` §9) with a scoped API credential — no more location or usage data shared with the vendor than the Tracking feature genuinely requires.
- **WhatsApp (Business API):** Message content sent through this channel is minimized for PII exposure where possible, consistent with Data Minimization (§5) — beyond what a Notification's own content genuinely needs to convey.
- **Payment Gateway:** Not yet a named vendor (`TECH_STACK.md` §23's Open Decisions) — regardless of which vendor is eventually selected, PCI-relevant isolation (`SYSTEM_ARCHITECTURE.md` §5's Payments module reasoning) applies as a fixed requirement, not a vendor-dependent one.
- **OpenAI:** A candidate LLM provider behind the Gateway abstraction (`TECH_STACK.md` §11) — data sent to it is bounded by `AI_STRATEGY.md` §5's Knowledge Sources rules; no raw Confidential/Restricted data (§5) is sent to a third-party model without a specifically justified, documented reason.
- **Anthropic (Claude):** Same treatment as OpenAI — the Gateway abstraction exists partly *for* this security reason, not only for swappability convenience: neither vendor is trusted with more than the abstraction boundary permits.
- **Future Providers:** Any new vendor integrated into BARQ must pass the same vendor security bar stated here retroactively — the abstraction layers already required by `TECH_STACK.md` §9/§11 exist as much for this security containment reason as for the swappability reason originally stated there.

## 13. Compliance Philosophy

This document states the security posture that *supports* compliance; it does not replace the legal/regulatory detail owned by future `COMPLIANCE_AND_LEGAL.md`:

- **Privacy:** Oman PDPL implications, flagged repeatedly across earlier planning, are a `COMPLIANCE_AND_LEGAL.md` responsibility — this document's data classification (§5) and minimization principles are designed to make eventual compliance easier, not to substitute for the legal analysis itself.
- **Tourism Regulations:** Ministry of Heritage & Tourism licensing implications — same treatment, deferred.
- **Financial Regulations:** Oman financial/VAT considerations affecting Invoicing/Payments — same treatment, deferred.
- **Data Residency:** A genuinely open question for a platform potentially using global cloud/AI vendors (§12) while serving an Oman-based Customer/Provider base — flagged in §16, not resolved here.
- **Least Data Collection:** Restated from §5's Data Minimization specifically as a compliance-supporting behavior — the less unnecessary data BARQ holds, the smaller its regulatory exposure surface, independent of which specific regulation eventually applies.

## 14. Future Security

Directional only, none committed for a specific date:

- **Penetration Testing:** Not yet performed — a candidate practice before or at launch, timing not decided here (§16).
- **Security Reviews:** A candidate recurring practice — cadence not yet defined.
- **Threat Modeling:** A candidate structured exercise per major feature going forward — not yet formalized as a required step in this project's Documentation → Design → Architecture sequence, though it would fit naturally into that sequence if adopted.
- **Vulnerability Management:** Dependency scanning is already named in `TECH_STACK.md` §16 — this item extends it to a defined patch-cadence process, not yet specified.
- **Security Automation:** Continuous security testing integrated into CI/CD (`TECH_STACK.md` §14) — a candidate future enhancement, not a current commitment.

## 15. Anti-Patterns

Explicitly forbidden, without exception:

- Never trust client input — every trust boundary in §3 treats the client as untrusted regardless of any client-side validation already performed.
- Never expose secrets — per §8; no secret appears in a repository, a log, a URL, or a client-visible response, ever.
- Never bypass authorization — per §4/§6; no path, including an AI Agent's (§7) or an internal service's, skips the authorization boundary for convenience.
- Never log sensitive data — per §5, §9; Confidential/Restricted data is masked wherever logging or observability output could otherwise capture it.
- Never give AI elevated privileges — per §7 and `ADR-0008` in full; an AI Service Identity's permissions are never broader than what its own governing specification documents.
- Never hardcode credentials — per §8; every credential is externally managed, never embedded in source.

## 16. Open Decisions

Intentionally deferred — not invented here:

1. **Key rotation cadence** (§8) — no specific schedule set.
2. **Alert thresholds** (§10) — specific numeric triggers not yet defined.
3. **Payment Gateway vendor selection** (§12) — still open per `TECH_STACK.md` §23.
4. **Data residency specifics** (§13) — genuinely open given global vendor dependencies against an Oman-based user base.
5. **Right-to-deletion vs. Audit-immutability tension** (§5) — a real, unresolved conflict between two legitimate requirements, not resolved here.
6. **Whether Admin authentication should exceed base OTP** (§3) — e.g. a second factor specifically for the highest-privilege role — not decided in this document or in `AUTHENTICATION.md`.
7. **Penetration testing timing and vendor** (§14) — not scheduled.
8. **Applicable Oman/GCC data protection law specifics** (§13) — deferred to `COMPLIANCE_AND_LEGAL.md`.

---

## Related Documents
- `PROJECT_MANIFEST.md`, `ARCHITECTURE_PRINCIPLES.md` Principles 11–12 — the founding commitments this document operationalizes in full
- `AUTHENTICATION.md`, `IDENTITY_AND_ACCESS.md` — identity and authorization, referenced throughout, never redefined
- `ADR-0008-ai-agent-boundaries.md` — governs §7 in full
- `DATABASE_DESIGN.md` §5, §9, §11, §14–§15, §18 — the data-layer security requirements this document elaborates and, for §11 specifically, resolves
- `API_CONTRACTS.md` §5, §7, §9–§10, §15, §18 — API-layer security this document elaborates without duplicating
- `TECH_STACK.md` §9, §11, §14–§16 — vendor and tooling context for §8–§9, §12
- `AI_STRATEGY.md` §5, §8, `AI_AGENTS.md` §14, §17 — governing §7 in full
- `PROJECT_RULES.md` §16 — the binding minimum this document now supersedes with complete detail
- `COMPLIANCE_AND_LEGAL.md` *(not yet written)* — will own the legal/regulatory detail §13 explicitly does not attempt

## Open Questions
1. Should `DATABASE_DESIGN.md` be revised to annotate every entity in its §5 table with the classification tier this document establishes (§5), closing that loop explicitly? Flagged as a deliberate follow-up action, not performed in this same pass, consistent with the process discipline established in recent turns.
2. Should Threat Modeling (§14) be formally added as a required step in this project's Documentation → Design → Architecture → Implementation sequence (`PROJECT_MANIFEST.md` Engineering Philosophy §6), or remain a candidate future practice? Flagged for a governance decision, not made unilaterally here.

## Future ADR References
- Any decision to adopt a specific Payment Gateway vendor (§12, Open Decision #3) should be evaluated for High Reversal Cost status and may require its own ADR, consistent with the precedent set by `ADR-0006`/`ADR-0007`.
- Any decision to add a second authentication factor for Admin (§16, Open Decision #6) would be a change to `AUTHENTICATION.md`'s core mechanism and should be recorded as an ADR if adopted, not a routine revision.
- Any future resolution of the right-to-deletion vs. audit-immutability tension (§5, Open Decision #5) that changes how BARQ handles financial/audit record deletion is exactly the kind of permanent-seeming rule change that warrants ADR-level rigor, given how many other documents already depend on immutability as a fixed assumption.
