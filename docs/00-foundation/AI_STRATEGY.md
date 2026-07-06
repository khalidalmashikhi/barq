# BARQ AI Strategy

- **Purpose:** Define the philosophy, governance, boundaries, responsibilities, and future evolution of Artificial Intelligence inside BARQ. AI is a first-class architectural capability, per `PROJECT_MANIFEST.md` AI Philosophy §7 and `ARCHITECTURE_PRINCIPLES.md` Principle 8 (AI First) — this document is where that commitment becomes governance.
- **Scope:** AI vision, principles, roles, boundaries, approved knowledge sources, memory strategy, prompt governance, safety, quality metrics, and roadmap — all at the level of philosophy and governance.
- **Out of Scope:** Implementation of any AI Agent, specific prompts, model selection, or technical architecture (owned by `AI_AGENTS.md`, and by `AI_PROMPTS.md`, `AI_MEMORY.md`, `AI_GUARDRAILS.md` once written — all subordinate to this document). Code of any kind.
- **Dependencies:** `PROJECT_MANIFEST.md` (AI Philosophy §7, Decision Framework §12), `ARCHITECTURE_PRINCIPLES.md` (Principle 8 AI First, Principle 23 Human-in-the-Loop), `DOMAIN_MODEL.md` (§1 AI Bounded Context, `AI Agent` entity and its one non-negotiable invariant), `ADR-0005-bilingual-architecture.md`, `PROJECT_RULES.md` (§20, AI Integration Rules).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Architect / AI Architect (BARQ core team).

---

## A Note on Two Different Uses of "AI" in This Project

This document governs AI as a **product and platform capability** — AI Agents that customers, providers, staff, and admins interact with inside BARQ. It does **not** govern the BARQ team's own use of AI assistance to draft code or documentation during the project's construction — that is a separate, already-governed concern under `PROJECT_RULES.md` §20.1–20.2 (mandatory human review of AI-generated content; mandatory logging in `DEVELOPMENT_LOG.md`). This distinction was flagged as an open question in `PROJECT_RULES.md`'s Open Questions and is resolved here: the two are related but separate governance domains, and this document is authoritative only for the former.

---

## 1. AI Vision

AI exists inside BARQ to make the platform faster, fairer, and more capable — for customers, for providers, for BARQ's own operations team — without ever becoming an unaccountable actor. Concretely:

- **For Customers:** AI reduces friction in discovering, booking, and getting help with tourism experiences, and can converse naturally in Arabic or English rather than forcing a single-language experience.
- **For Providers:** AI helps providers operate more efficiently — surfacing relevant information, reducing manual work — without ever taking pricing or business control away from them (Provider-Set Pricing remains inviolate; see `GLOSSARY.md` term 20).
- **For Operations:** AI supports Staff and the Operations Center with faster triage, summarization, and recommendation — augmenting human judgment on live situations, not replacing it.
- **For Internal Efficiency:** AI accelerates BARQ's own team — documentation, development assistance, knowledge retrieval — under the same human-review discipline as any other AI use, per `PROJECT_RULES.md` §20.

AI at BARQ is judged by one standard: does it make the platform more trustworthy, not just faster? Per `PROJECT_MANIFEST.md` Decision Framework §12, speed never buys its way past that question.

---

## 2. AI Principles

### Human First

- **Why:** AI serves people; it does not become the thing people serve. This is the root from which every other principle here derives.
- **Meaning:** Every AI capability is evaluated first by its effect on the humans involved — customers, providers, staff — not by its technical impressiveness.
- **What it Prevents:** Building AI capability for its own sake, disconnected from real user benefit.

### AI Assists, Humans Decide

- **Why:** Directly operationalizes `PROJECT_MANIFEST.md` §7 and `ARCHITECTURE_PRINCIPLES.md` Principle 23.
- **Meaning:** AI Agents recommend, draft, summarize, and flag; humans (Staff, Admin, or the Customer/Provider themselves) make the actual decision on anything consequential.
- **What it Prevents:** Autonomous AI action on money, trust, or legal matters without a human ever having reviewed it — see §4, AI Boundaries.

### Explainable Decisions

- **Why:** A recommendation no one can explain cannot be trusted, audited, or corrected when wrong.
- **Meaning:** Every AI-generated recommendation or output must be traceable to the knowledge and reasoning that produced it, in terms a human reviewer can actually evaluate.
- **What it Prevents:** "Black box" outputs that Staff or Admin are expected to approve without understanding why the AI suggested them.

### Bilingual by Design

- **Why:** Fully governed by `ADR-0005-bilingual-architecture.md` — referenced here, not restated, per SSOT.
- **Meaning:** Every AI Agent that interacts with a person must do so naturally in both Arabic and English, per `ADR-0005` requirement 11.
- **What it Prevents:** AI capability that quietly launches English-first with Arabic "to follow" — the exact failure mode `ADR-0005` exists to rule out, including in AI specifically.

### Privacy by Design

- **Why:** AI systems are unusually good at inferring and retaining more than they were given — that tendency has to be constrained deliberately.
- **Meaning:** AI Agents access only the data their documented function requires, and per §5–§6, never retain more than their defined memory strategy permits.
- **What it Prevents:** AI Agents becoming an unaccounted-for surveillance or data-aggregation surface across BARQ's domains.

### Security by Design

- **Why:** An AI Agent with excess permissions is a new, unusually persuasive attack surface — for prompt injection, for social engineering, for privilege escalation.
- **Meaning:** AI Agents operate under the same least-privilege discipline as any other system actor, enforced at the permission layer, not by trusting the AI's own judgment.
- **What it Prevents:** An AI Agent being tricked (by a user, or by content it processes) into taking an action outside its authorized scope.

### Transparent Automation

- **Why:** People interacting with BARQ have a right to know when they're talking to an AI Agent versus a human.
- **Meaning:** AI-driven interactions are disclosed as such — no impersonation of a human Staff member or Provider.
- **What it Prevents:** Erosion of trust through deceptive automation, which would directly violate `PROJECT_MANIFEST.md`'s Customer Promise §9 and Provider Promise §10.

### AI Never Invents Business Rules

- **Why:** Business rules (pricing, commission, eligibility) are owned by the Domain Layer per `ARCHITECTURE_PRINCIPLES.md` Principle 24 — AI is a consumer of that layer, never an alternate source of truth for it.
- **Meaning:** An AI Agent may explain, apply, or recommend within existing documented business rules; it may never fabricate a rule that isn't already approved and documented.
- **What it Prevents:** A customer or provider being told a "rule" by an AI Agent that doesn't actually exist in BARQ's approved documentation — a direct trust and legal liability.

### AI Never Owns Business Data

- **Why:** Directly follows from `DOMAIN_MODEL.md`'s Bounded Context ownership model — the AI context "Does Not Own" any business decision it merely assists with.
- **Meaning:** AI Agents read and reference business data owned by other Bounded Contexts; they never become the system of record for Booking, Payment, Wallet, or any other domain entity.
- **What it Prevents:** Data ownership fragmenting into an AI layer that other systems can no longer authoritatively query.

### AI Learns From Approved Knowledge Only

- **Why:** Directly enforced by §5 below — an AI system that can absorb unapproved or informal information as if it were fact will eventually state something false with confidence.
- **Meaning:** AI Agents' knowledge is limited to the explicitly approved sources listed in §5; nothing else is treated as ground truth.
- **What it Prevents:** Hallucinated or informally-sourced "knowledge" being presented with the same confidence as approved documentation.

---

## 3. AI Roles Inside BARQ

Each role below is a **capability category**, not a specification — full behavioral detail, exact scope, and technical design are owned by `AI_AGENTS.md` for each role.

### Customer Assistant
- **Purpose:** Help customers discover, book, and get support for tourism experiences, bilingually.
- **Responsibilities:** Answer questions using approved knowledge, guide booking flows, summarize booking status.
- **Allowed Actions:** Retrieve and present information; draft (not send) messages; suggest available Services/Experiences.
- **Forbidden Actions:** Confirming a Booking, processing a Payment, or modifying a Wallet without the Customer's own explicit action; inventing availability or pricing not reflected in approved data.
- **Human Approval Requirements:** None for pure information retrieval; required for any action with financial or contractual consequence.

### Provider Assistant
- **Purpose:** Help Service Providers manage listings, availability, and understand their commission/payout status.
- **Responsibilities:** Summarize performance, draft (not publish) listing content, explain commission calculations.
- **Allowed Actions:** Retrieve Provider-specific data; draft suggested content or pricing (final price remains Provider's own decision per Provider-Set Pricing).
- **Forbidden Actions:** Setting a Provider's `Price` autonomously, changing `Commission` tier, approving itself or another Provider.
- **Human Approval Requirements:** Provider must approve any drafted content/pricing suggestion before it takes effect.

### Operations Assistant
- **Purpose:** Support Staff in the Operations Center with real-time triage and summarization.
- **Responsibilities:** Summarize active incidents, flag anomalies (e.g. a Journey running unusually long), suggest next actions.
- **Allowed Actions:** Retrieve and correlate operational data; generate summaries and flags.
- **Forbidden Actions:** Dispatching a Driver/Guide autonomously, closing a Support Ticket, making a Dispute determination.
- **Human Approval Requirements:** All operational actions with real-world consequence remain Staff-executed; the Assistant informs, Staff acts.

### Admin Assistant
- **Purpose:** Support Admins with configuration review and platform oversight.
- **Responsibilities:** Summarize platform state, draft configuration change proposals for review.
- **Allowed Actions:** Retrieve platform data; draft proposals.
- **Forbidden Actions:** Approving or suspending a Provider, changing Commission policy, modifying any configuration directly — see §4.
- **Human Approval Requirements:** All configuration changes require explicit Admin approval; the Assistant never applies its own proposal.

### Support Assistant
- **Purpose:** Help triage and draft responses to Support Tickets.
- **Responsibilities:** Summarize ticket context, suggest response drafts, identify likely Dispute escalations.
- **Allowed Actions:** Retrieve ticket/booking context; draft (not send) responses.
- **Forbidden Actions:** Resolving a ticket involving money without human sign-off; issuing a refund.
- **Human Approval Requirements:** Required for any ticket resolution with financial consequence.

### Marketing Assistant
- **Purpose:** Support content and campaign drafting for BARQ's own marketing.
- **Responsibilities:** Draft bilingual marketing copy consistent with `BRANDING.md` (not yet written) once it exists.
- **Allowed Actions:** Draft content for human review.
- **Forbidden Actions:** Publishing content autonomously; making claims not verifiable against approved documentation.
- **Human Approval Requirements:** All external-facing content requires human approval before publication.

### Finance Assistant
- **Purpose:** Support Staff/Admin with financial summarization and reporting.
- **Responsibilities:** Summarize Wallet activity, Commission trends, flag anomalies for review.
- **Allowed Actions:** Retrieve and summarize financial data.
- **Forbidden Actions:** Initiating any `Payment`, `Payout`, `Wallet Transaction`, or `Refund` — absolute, no exception; see §4.
- **Human Approval Requirements:** All financial action remains human-executed; the Assistant never touches money directly.

### Documentation Assistant
- **Purpose:** Support the drafting and maintenance of BARQ's own documentation set (this document included).
- **Responsibilities:** Draft, suggest revisions, check for SSOT violations or terminology drift against `GLOSSARY.md`.
- **Allowed Actions:** Draft content for human review, per `PROJECT_RULES.md` §20.1.
- **Forbidden Actions:** Marking any document Approved/Locked itself; that is a human governance action only.
- **Human Approval Requirements:** Every document lifecycle transition (§10, `PROJECT_RULES.md`) requires human review — no exception for this role either.

### Developer Assistant
- **Purpose:** Support engineering work once implementation begins, per `PROJECT_RULES.md` §20.1's existing governance.
- **Responsibilities:** Draft code for human review, per the project's Documentation → Design → Architecture → Implementation → Testing → Documentation Update sequence.
- **Allowed Actions:** Draft code/tests for human review.
- **Forbidden Actions:** Merging its own code, bypassing Code Review Rules (`PROJECT_RULES.md` §14).
- **Human Approval Requirements:** Full code review per §14, no exception for AI-authored code.

### Knowledge Assistant
- **Purpose:** Help any human or AI Agent locate the correct approved knowledge source (§5) rather than guessing.
- **Responsibilities:** Retrieve and surface relevant approved documentation; identify when no approved source answers a question.
- **Allowed Actions:** Retrieve and cite approved sources.
- **Forbidden Actions:** Fabricating an answer when no approved source exists — must state the gap instead, per the "AI Never Invents" principle above.
- **Human Approval Requirements:** None for retrieval itself; any resulting documentation change follows normal document lifecycle review.

---

## 4. AI Boundaries

AI may **never**, under any framing, justification, or urgency:

- Approve or suspend a Service Provider.
- Change a Commission tier or rate.
- Transfer, capture, refund, or otherwise move money in any form.
- Delete any record, of any kind.
- Sign or finalize a Contract.
- Override, edit, or suppress an Audit Log or Activity Log entry.
- Modify system, security, or architectural configuration.
- Invent a business rule, policy, or price not already approved and documented.
- Access data outside its documented, authorized scope.
- Represent itself as a human Staff member, Provider, or Admin.

Anything affecting **trust, money, or legal obligation** requires Human-in-the-Loop, without exception — this is the same invariant stated in `DOMAIN_MODEL.md`'s `AI Agent` entity definition, restated here as the platform's absolute AI boundary rather than merely an entity-level note.

---

## 5. Knowledge Sources

AI Agents may treat as authoritative **only** the following approved sources:

- `PROJECT_MANIFEST.md`
- `GLOSSARY.md`
- `PROJECT_RULES.md`
- `ARCHITECTURE_PRINCIPLES.md`
- `DOMAIN_MODEL.md`
- This document, `AI_STRATEGY.md`
- Any Approved (v1.0/Locked) ADR
- Any Approved RFC that has produced its closing ADR
- Any other Approved (v1.0/Locked) BARQ documentation
- A future formally designated Knowledge Base, once one exists and is itself approved as a source

**AI must never invent missing knowledge.** Where an approved source doesn't answer a question, the correct AI behavior is to say so — per the Knowledge Assistant role above — not to infer, guess, or fill the gap with plausible-sounding content. This is the practical enforcement mechanism for the "AI Learns From Approved Knowledge Only" principle in §2.

---

## 6. AI Memory Strategy

Full technical mechanics are owned by `AI_MEMORY.md` (not yet written); this section defines the strategy it must implement.

- **Short-term Session Memory:** Information relevant only to the current interaction (e.g. the current conversation's context). Owned by the session; discarded when the session ends unless explicitly promoted to Conversation Memory with the user's awareness.
- **Long-term Knowledge:** The approved knowledge sources in §5 — not something an AI Agent accumulates itself, but a fixed, versioned reference it queries.
- **Conversation Memory:** History of a specific user's past interactions, where retaining it materially improves their experience (e.g. remembering a stated preference). Subject to Privacy by Design (§2) — retained only with clear scope and only as long as necessary.
- **Business Memory:** Facts about business entities (a Provider's current Commission tier, a Booking's status) — this is never memory in the AI sense; it is always a live read from the owning Bounded Context, never a cached or remembered copy that could drift from the actual record.
- **Project Memory:** Applies only to the Documentation/Developer Assistant roles — awareness of this project's own documentation history, itself sourced only from §5's approved sources, never from informal or unapproved discussion.

**State Ownership:** Business Memory is never owned by an AI Agent — it is owned by the Bounded Context that owns the underlying entity (per `DOMAIN_MODEL.md`), and the AI Agent only ever reads it live.

**Memory Limitations:** No AI Agent retains Conversation Memory beyond what its documented function requires, and never retains anything from §4's forbidden categories (e.g. no memory of unapproved workarounds a user described attempting).

**What AI Must Never Remember:** Payment credentials or financial instrument details, authentication secrets, any content explicitly marked as not-for-retention by policy, and anything a user has asked to be forgotten, subject to legal retention obligations documented elsewhere (`COMPLIANCE_AND_LEGAL.md`, not yet written).

---

## 7. Prompt Governance

Full mechanics owned by `AI_PROMPTS.md` (not yet written); the governing strategy is:

- **Prompt Versioning:** Every prompt used in production is versioned; changes produce a new version, not a silent overwrite of the old one — consistent with this project's document lifecycle discipline (`PROJECT_RULES.md` §10) applied to prompts as a governed artifact.
- **Prompt Reviews:** No prompt reaches production use without human review against the principles in §2 and the boundaries in §4.
- **Prompt Ownership:** Each prompt has a named owner accountable for its behavior, mirroring this project's document ownership convention.
- **Prompt Lifecycle:** Draft → Reviewed → Approved → Active → (Retired), analogous to the Document Lifecycle.
- **Prompt Testing:** Prompts are evaluated against defined test cases (including adversarial/prompt-injection cases, per §8) before Approval.
- **Prompt Approval:** Requires the same human sign-off standard as any other AI-governance artifact — no self-approval.
- **Prompt Retirement:** A retired prompt is archived, not deleted, for auditability — consistent with this project's general immutability pattern (see `DOMAIN_MODEL.md`'s Wallet Transaction, Route invariants as the same pattern applied elsewhere).

---

## 8. AI Safety

- **Hallucination Prevention:** Enforced primarily by §5 (approved-knowledge-only) and the Knowledge Assistant's obligation to state gaps rather than fill them.
- **Data Protection:** Enforced by Privacy by Design and Security by Design (§2) — least-privilege data access, no excess retention.
- **Prompt Injection Protection:** AI Agents must treat content they process (documents, messages, web content) as data, not as instructions — an AI Agent must never take an action because untrusted content it read told it to, only because an authorized human or system instructed it to.
- **Role Isolation:** Each AI role in §3 operates within its own defined scope; a Customer Assistant cannot act with Admin Assistant's authority, even if asked to.
- **Permission Boundaries:** Enforced at the system/permission layer, not by trusting an AI Agent's own judgment about what it should or shouldn't do.
- **Confidence Reporting:** Where an AI Agent's output is a recommendation rather than a retrieval of fact, this must be distinguishable to the human reviewing it — full mechanics owned by `AI_GUARDRAILS.md` (not yet written).
- **Fallback to Human:** Every AI role has a defined escalation path to a human when confidence is low, knowledge is insufficient, or the action requested falls outside its Allowed Actions.

---

## 9. AI Quality Metrics

Full targets and measurement mechanics are owned by future `KPIS.md`/`METRICS.md` (not yet written); the categories BARQ will measure AI against are:

- Accuracy
- Latency
- Hallucination Rate
- Acceptance Rate (how often a human accepts an AI recommendation as-is)
- Human Override Rate (how often a human corrects or rejects an AI output)
- Customer Satisfaction (for customer-facing roles)
- Resolution Time (for support/operations roles)

These categories are stated here so that `AI_AGENTS.md` designs each role to be measurable against them from the start — not retrofitted with metrics after the fact.

---

## 10. Future AI Roadmap

The following are directionally intended, not committed, scoped, or scheduled — each would require its own RFC/ADR and capability documentation before any work begins, per this project's standard process:

- Multi-agent collaboration (multiple AI roles coordinating on a single complex task)
- Autonomous workflows (bounded, low-risk automation graduating out of Human-in-the-Loop only after sustained demonstrated reliability and explicit governance sign-off)
- Voice assistants (bilingual voice interaction)
- Predictive analytics (demand patterns, operational forecasting)
- Demand forecasting (for Providers and Operations)
- Dynamic recommendations (personalized Service/Experience suggestions)
- Fraud detection (pattern-based flagging for human review — never autonomous account/financial action)
- Pricing recommendations (recommendations only — Provider-Set Pricing remains inviolate per §2 and `GLOSSARY.md` term 20)

---

## Related Documents
- `PROJECT_MANIFEST.md` — AI Philosophy §7, the source of this document's authority
- `ARCHITECTURE_PRINCIPLES.md` — Principle 8 (AI First), Principle 23 (Human-in-the-Loop)
- `DOMAIN_MODEL.md` — the AI Bounded Context and `AI Agent` entity this document elaborates
- `PROJECT_RULES.md` — §20, the process-level AI rules this document's "Two Different Uses of AI" note reconciles with
- `ADR-0005-bilingual-architecture.md` — governs the Bilingual by Design principle referenced in §2
- `AI_AGENTS.md` — owns full implementation detail for §3's roles
- `AI_MEMORY.md`, `AI_PROMPTS.md`, `AI_GUARDRAILS.md` *(not yet written)* — each owns full implementation detail for a section of this document

## Open Questions
1. This document proposes resolving `PROJECT_RULES.md`'s Open Question #1 (the AI-Integration-Rules scope ambiguity) by treating product AI and engineering-process AI as related but distinct governance domains. This is a proposal made here, not a unilateral edit to `PROJECT_RULES.md` — confirm whether `PROJECT_RULES.md` should be formally updated to cross-reference this resolution once this document is Approved.
2. §10's "Autonomous workflows" item mentions graduating out of Human-in-the-Loop after "sustained demonstrated reliability" — what that threshold actually is, and who has authority to approve such a graduation, is undefined and should be a required RFC topic before any autonomous workflow is considered, not decided informally later.
3. Should each AI Role in §3 eventually get its own dedicated sub-document, or remain consolidated in one `AI_AGENTS.md` as it is today? `AI_AGENTS.md` has since been drafted and consolidated all roles into one document — this question is not thereby resolved, only deferred further; still flagged, not decided here.

## Future ADR References
- Any future addition of a new AI Role, or expansion of an existing role's Allowed Actions, requires an ADR once this document reaches Locked status.
- Any proposal to relax a §4 AI Boundary requires an ADR at the highest review tier, consistent with how `PROJECT_MANIFEST.md` treats its own core commitments — a boundary listed in §4 should be treated with that same permanence.
