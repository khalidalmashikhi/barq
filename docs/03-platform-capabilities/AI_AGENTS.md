# BARQ AI Agents

- **Purpose:** Define every AI Agent in BARQ — responsibilities, permissions, capabilities, limitations, inputs, outputs, human escalation, memory, KPIs, and inter-agent communication. This document defines AI Agents only; it does not define prompts, implementation, or LLM providers.
- **Scope:** The AI Agent taxonomy and detailed specifications for Customer Assistant, Provider Assistant, Operations Assistant, Support Assistant, Finance Assistant, Admin Assistant, and Knowledge Assistant; agent communication, memory, escalation, explainability, KPIs, and future evolution.
- **Out of Scope:** Prompts, implementation, API definitions, model selection — all explicitly excluded per instruction. Detailed specifications for Marketing Assistant, Documentation Assistant, and Developer Assistant (named at the strategy level in `AI_STRATEGY.md` §3, not elaborated here — see Open Decisions, §18).
- **Dependencies:** `PROJECT_MANIFEST.md` §7, `ARCHITECTURE_PRINCIPLES.md` Principle 8/23, `AI_STRATEGY.md` (§2–§10, the strategy this document specifies against), `ADR-0008-ai-agent-boundaries.md` (the permanent, binding governance every agent below complies with — referenced throughout, never contradicted), `DOMAIN_MODEL.md` (the AI Bounded Context and every other context an agent below reads from), `SYSTEM_ARCHITECTURE.md` (§4–§6, §12, the AI Layer's architectural isolation), `DATABASE_DESIGN.md` §13, `API_CONTRACTS.md` §13, `DESIGN_SYSTEM.md` §17.
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / AI Architect (BARQ core team).

---

## 1. Executive Summary

BARQ's AI workforce is a set of governed, narrowly-scoped assistants — never autonomous decision-makers — each specified against the permanent boundaries in `ADR-0008-ai-agent-boundaries.md`. Every agent below reads business data through governed Application Layer interfaces (`SYSTEM_ARCHITECTURE.md` §4), escalates to a human for anything `ADR-0008` designates as requiring approval, and identifies itself as AI in every interaction. This document does not grant any capability `ADR-0008` forbids; where a request in this document's source instructions could be read as expanding an agent's authority beyond that ADR, this document holds the ADR's line rather than the more permissive reading.

## 2. AI Workforce Philosophy

- **AI as Assistant:** Every agent below drafts, recommends, summarizes, or retrieves — none of them decide anything `ADR-0008` reserves for a human.
- **Human Remains Responsible:** For every action an agent below takes, a specific human role (Customer, Provider, Staff, or Admin) retains accountability for the outcome — the agent's involvement never diffuses that accountability.
- **AI Augments:** Each agent exists to make its corresponding human role faster and better-informed, per `BUSINESS_MODEL.md` §4's value propositions — not to reduce headcount or remove a role's judgment from the process.
- **Never Replaces Accountability:** Consistent with `ADR-0008` point 17 (Human operators always have final authority) — no agent specification below is written in a way that could be read as removing a human's ability to override, halt, or reverse its output.

## 3. AI Agent Taxonomy

- **Operational Agents:** Operations Assistant (§6) — serves real-time platform operations.
- **Customer Agents:** Customer Assistant (§4) — serves travelers directly.
- **Provider Agents:** Provider Assistant (§5) — serves Service Providers, Drivers, Guides, Fleet Owners, Tourism Companies.
- **Staff Agents:** Support Assistant (§7), Finance Assistant (§8), Admin Assistant (§9) — serve BARQ's own internal team. (Marketing, Documentation, and Developer Assistants, named at the strategy level in `AI_STRATEGY.md` §3, also belong conceptually in this category but are not detailed in this document — §18.)
- **Knowledge Agents:** Knowledge Assistant (§10) — serves any human or agent needing approved knowledge retrieval.
- **Future Agents:** Voice Agent, WhatsApp Agent, Manager Agent (§16) — directional, not specified in detail here.

## 4. Customer Assistant

- **Responsibilities:** Answer Customer questions using approved knowledge (`AI_STRATEGY.md` §5); guide discovery and booking flows; summarize Booking status; draft (not send) support messages.
- **Inputs:** The Customer's own conversation history (within Memory limits, §12), publicly bookable Service/Experience data, the Customer's own Booking history, approved knowledge sources.
- **Outputs:** Conversational responses in Arabic or English; suggested Services/Experiences; drafted messages for the Customer's own review before sending.
- **Permissions:** Read-only access to the Customer's own data and public Provider/Service listings, via governed Application Layer interfaces (`ADR-0008` points 3–4). Never confirms a Booking, processes a Payment, or modifies a Wallet on the Customer's behalf without the Customer's own explicit action.
- **Memory:** Session-scoped Conversation Memory per `AI_STRATEGY.md` §6; no cross-Customer memory; no retention beyond what materially improves the current or a clearly continued interaction.
- **Escalation:** Any request involving payment disputes, refunds, or anything the Customer indicates dissatisfaction about beyond a simple question — escalates to Support Assistant (§7) or directly to a human Staff member, per §13.
- **KPIs:** Resolution Rate (questions answered without escalation), Customer Satisfaction, Latency, Hallucination Rate (per `AI_STRATEGY.md` §9's categories — specific targets owned by future `KPIS.md`, not this document).

## 5. Provider Assistant

- **Responsibilities:** Driver/Guide onboarding assistance (explaining required steps, not making approval decisions); Profile completion guidance (Service/Experience listing quality); Availability guidance (helping a Provider understand and manage their own Availability data); Booking communication (summarizing incoming Booking details to the Provider); Performance insights (summarizing the Provider's own Booking/Rating history).
- **Inputs:** The Provider's own account, listing, Availability, Booking, and Wallet-summary data (never another Provider's); approved knowledge sources.
- **Outputs:** Guidance text; draft listing content the Provider must approve before publishing (per `AI_STRATEGY.md` §3's original Provider Assistant scope); performance summaries.
- **Permissions:** Read-only access to the requesting Provider's own data. Never sets a Provider's `Price` autonomously, never changes a Commission tier, never approves the Provider itself or any other Provider (`ADR-0008` point 7). Draft content requires the Provider's own explicit approval before taking effect.
- **Memory:** Session-scoped, Provider-account-scoped Conversation Memory; no cross-Provider memory.
- **Escalation:** Onboarding questions the Assistant cannot answer from approved knowledge; any Provider dispute about Commission or a specific Booking's payout — escalates to a human Staff member or Admin Assistant (§9) as appropriate.
- **KPIs:** Resolution Rate, Provider satisfaction/engagement with guidance, Acceptance Rate of draft content suggestions, Latency.

## 6. Operations Assistant

- **Responsibilities:** Booking monitoring (surfacing anomalies — e.g. a Booking stuck unconfirmed); Trip/Journey monitoring (flagging a Journey running unusually long, per `SYSTEM_ARCHITECTURE.md` §5's Operations module reasoning); Dispatch support (surfacing available Drivers/Guides/Vehicles to a human dispatcher — never assigning one itself); Alerts (proactive flags to Operations Agents); Recommendations (suggested next actions, never autonomous ones).
- **Inputs:** Real-time Booking, Journey, and Support Ticket data within the Operations Bounded Context's observation scope (`DOMAIN_MODEL.md` §1 — Operations "observes via reference and subscription only").
- **Outputs:** Alerts, summaries, and ranked recommendations surfaced to a human Operations Agent's interface (`DESIGN_SYSTEM.md` §17).
- **Permissions:** Read-only, real-time observation access. **Never dispatches autonomously** — assigning a Driver/Guide/Vehicle to a Booking, or taking any action that changes Booking/Journey state, is always a human Operations Agent's action, even when this Assistant's recommendation is the one acted on.
- **Memory:** Operationally-scoped, short-lived — this Assistant's relevant "memory" is almost entirely live Business Memory (`AI_STRATEGY.md` §6), not accumulated Conversation Memory, since its function is real-time observation, not ongoing dialogue.
- **Escalation:** Any anomaly the Assistant cannot classify confidently; anything indicating a safety concern (e.g. a Journey deviating unusually from its expected route) escalates immediately and directly to a human Operations Agent, never held for later review.
- **KPIs:** Alert precision (how often a flagged anomaly was real), Latency (time from anomaly to alert), Human Override Rate, Resolution Time contribution (does the Assistant's alert shorten the time to human resolution).

## 7. Support Assistant

- **Responsibilities:** FAQ handling; Support Ticket triage (categorizing and prioritizing, not resolving unilaterally); Customer/Provider guidance during an open ticket; sentiment awareness (recognizing frustration or urgency to prioritize human attention appropriately).
- **Inputs:** The relevant Support Ticket, its linked Booking (if any), the requester's own account data, approved knowledge sources.
- **Outputs:** Draft responses for Staff review; ticket categorization/priority suggestions; sentiment flags.
- **Permissions:** Read-only on ticket/account/Booking context; drafts only, never sends a final response or resolves a ticket unilaterally — especially never resolves a ticket with financial consequence (refund, credit) without human sign-off, per `ADR-0008` points 5–6, 12.
- **Memory:** Ticket-scoped Conversation Memory; no retention beyond the ticket's own lifecycle unless explicitly needed for a linked, ongoing Dispute.
- **Escalation:** Any ticket the sentiment signal flags as high-urgency or high-frustration; any ticket involving a refund, Dispute, or Provider Suspension — escalates to a human Staff member per §13, and to Finance Assistant (§8) only for explanation support, never resolution authority.
- **KPIs:** First-response time contribution, Ticket categorization accuracy, Human Override Rate, Customer/Provider Satisfaction on resolved tickets.

## 8. Finance Assistant

- **Responsibilities:** Invoice explanation (helping a Customer/Provider understand what an Invoice reflects); Commission explanation (helping a Provider understand how their Commission was calculated); Wallet explanation (helping a Provider understand their balance and transaction history).
- **Inputs:** The requesting party's own Invoice, Commission, and Wallet data (never another party's).
- **Outputs:** Plain-language explanations of existing financial records — never a new financial record, never a projection presented as a commitment.
- **Permissions:** Read-only, explanation-only. **Never approves payouts. Never modifies balances.** This is absolute, per `ADR-0008` points 5–6 and `AI_STRATEGY.md` §3's original Finance Assistant restriction — no framing of urgency, convenience, or a "small" amount changes this.
- **Memory:** Session-scoped only; financial data itself is never cached or remembered by this Assistant — every explanation is generated from a live read of the actual record (`AI_STRATEGY.md` §6's Business Memory rule, applied specifically here since this is the highest-risk agent for that rule to be violated).
- **Escalation:** Any question implying a Wallet/Invoice/Commission discrepancy, any refund or payout request of any kind — escalates immediately to a human Staff member or Admin; this Assistant never attempts to resolve a discrepancy itself.
- **KPIs:** Explanation clarity (proxy: reduced repeat questions on the same record), Resolution Rate for pure explanation requests, Latency, zero tolerance for Hallucination Rate on any stated number (a wrong financial explanation is treated as a severe defect, not a normal error rate to be optimized down over time).

## 9. Admin Assistant

- **Responsibilities:** Reports (summarizing platform state); Analytics (surfacing trends in Bookings, Providers, Commission revenue); Recommendations (e.g. flagging a Provider whose metrics suggest review); Configuration advice (explaining what a configuration change would do, before an Admin decides).
- **Inputs:** Platform-wide aggregate and entity-level data within Admin's own authorized scope (`DOMAIN_MODEL.md` Administration context).
- **Outputs:** Reports, summaries, ranked recommendations, and plain-language explanations of configuration options.
- **Permissions:** Read-only, advisory-only. **Never changes configuration** — Commission tier policy, Provider approval/suspension, and any platform configuration change remain exclusively human Admin actions (`ADR-0008` points 7, 12), regardless of how confidently this Assistant's recommendation is stated.
- **Memory:** Session-scoped; no persistent memory of specific Admin decisions beyond what's already recorded in the Audit Log it can read from (never a separate AI-side record of "what this Admin usually does").
- **Escalation:** Any recommendation touching Commission policy or Provider Approval is presented as a recommendation requiring the Admin's own decision — this is not really an "escalation" so much as this Assistant's permanent operating mode for anything in that category, per `ADR-0008` point 12.
- **KPIs:** Recommendation Acceptance Rate, report accuracy, Latency, Admin-reported usefulness (a qualitative signal, not purely automatable).

## 10. Knowledge Assistant

- **Responsibilities:** Internal documentation retrieval; policy lookup; training material assistance; general knowledge retrieval for any human or other agent needing to locate an approved source rather than guess.
- **Inputs:** The full approved knowledge source list in `AI_STRATEGY.md` §5 — nothing else.
- **Outputs:** Retrieved, cited answers; an explicit statement that no approved source answers a question, when that's true, rather than a fabricated answer.
- **Permissions:** Read-only against approved documentation only. Never treats an unapproved source (informal chat, a draft document, external web content) as ground truth.
- **Memory:** No persistent memory beyond the current retrieval session — this Assistant's entire value is querying a fixed, versioned knowledge set live, not remembering past answers that could drift from the source as documents are updated.
- **Escalation:** When no approved source answers a question, the Assistant states this explicitly and, where relevant, flags it as a candidate gap for a human to consider documenting — it does not attempt to fill the gap itself.
- **KPIs:** Retrieval accuracy, Hallucination Rate (this Assistant should have the platform's lowest tolerance for it, since its entire function is faithful retrieval), citation completeness.
- **Future RAG:** A Retrieval-Augmented Generation approach is the most likely eventual implementation mechanism for this Assistant once a formal Vector Store/Knowledge Base exists (`DATABASE_DESIGN.md` §13, §19; `AI_STRATEGY.md` §10) — not committed for V1, and this document does not specify RAG mechanics regardless (Out of Scope).

## 11. Agent Communication

- **Shared Context:** Where a handoff between agents is useful (e.g. Support Assistant escalating context to a human, or Finance Assistant being consulted for an explanation during a Support Assistant interaction), the relevant Business Memory (live data, never cached) and the minimum necessary Conversation Memory travel with the handoff — never more than the receiving agent's own Permissions (per §4–§10) would independently authorize it to see.
- **Message Bus:** BARQ does not currently operate a formal cross-agent message bus — consistent with `SYSTEM_ARCHITECTURE.md` §11's note that a formal Event Bus is a future item, not a current one. Agent-to-agent coordination today happens through the same in-process domain event pattern (`ARCHITECTURE_PRINCIPLES.md` Principle 15) that governs cross-module communication generally — this document does not introduce a separate, AI-specific communication infrastructure ahead of that broader architectural decision.
- **Context Boundaries:** No agent receives context beyond its own documented Permissions (§4–§10) merely because another agent happens to have had it — a handoff transfers only what the receiving agent is independently authorized for.
- **Handoffs:** Explicit, logged (per `ADR-0008` point 13's universal auditability requirement), and always terminate in either a resolved interaction or a human escalation (§13) — never an indefinite loop between agents with no human ever engaged.

## 12. Agent Memory

Fully governed by `AI_STRATEGY.md` §6 and `DATABASE_DESIGN.md` §13 — this section states only the agent-specific application of those rules, not a new memory model:

- **Conversation Memory:** Scoped per-agent, per-requester, as detailed in each agent's own Memory field above — never shared across unrelated requesters, never retained longer than the interaction (or a clearly continued one) requires.
- **Session Memory:** Short-term, ephemeral, discarded at session end unless explicitly and narrowly promoted, per `AI_STRATEGY.md` §6.
- **Business Memory:** Never owned or cached by any agent above — every reference to Booking, Wallet, Provider, or any other business data is a live read through the owning Bounded Context's governed interface (`ADR-0008` points 3–4), restated here because it is the single most safety-critical memory rule this document depends on.
- **Privacy:** Every agent's data access is scoped to what its documented Responsibilities and Permissions require — no agent above is authorized to browse data outside its own stated inputs "just in case it's useful."
- **Retention:** No agent retains Conversation Memory beyond what its function requires (§4–§10 individually), and none retain anything in `AI_STRATEGY.md` §6's explicit never-remember list (payment credentials, authentication secrets, content marked not-for-retention).

## 13. Human Escalation

Universal triggers, applicable across every agent in §4–§10, in addition to each agent's own specific escalation notes:

- **Confidence:** Any output below the agent's own reasonable confidence threshold escalates rather than being presented as settled.
- **Risk:** Any request whose consequence the agent cannot fully characterize escalates rather than proceeding on a best guess.
- **Money:** Any action with financial consequence beyond pure explanation (§8) escalates, per `ADR-0008` points 5–6, 12.
- **Legal:** Any Contract-related request beyond drafting/summarizing escalates, per `ADR-0008` point 8.
- **Disputes:** Any Support Ticket that becomes a formal Dispute escalates, per `ADR-0008` point 12.
- **Provider Approval:** Never attempted by any agent, per `ADR-0008` point 7 — not an escalation trigger so much as a permanent exclusion, restated here for completeness.
- **Manual Override:** Any request to override an existing system state or decision escalates, per `ADR-0008` point 12.

Every escalation is logged with the fields `ADR-0008` point 15 requires (Actor, Timestamp, Reason, Confidence, Trace ID, Correlation ID) — this document does not restate that requirement's mechanics, only confirms it applies to every escalation event above without exception.

## 14. Explainability

- **Reasoning Summary:** Every agent's non-trivial output (a recommendation, a flagged anomaly, a drafted response) should be accompanied by a plain-language summary of why it produced that output — per `AI_STRATEGY.md` §2's Explainable Decisions principle.
- **Confidence:** Stated distinguishably wherever an output is a recommendation rather than a retrieval of fact, per `ADR-0008` point 16 and `API_CONTRACTS.md` §13.
- **Sources:** Every factual claim traces to an approved knowledge source (§10) or a live business-data read (§12) — never an unattributed claim.
- **Limitations:** Where an agent's own Permissions (§4–§10) prevent it from fully answering a request, it states that limitation explicitly rather than working around it or answering a narrower question as if it were the one asked.

## 15. AI KPIs

Applicable across every agent, per `AI_STRATEGY.md` §9's categories — specific numeric targets are owned by future `KPIS.md`, not this document:

- **Resolution Rate** — how often an agent's interaction concludes without human escalation.
- **Escalation Rate** — the inverse and complementary signal to Resolution Rate; a *low* escalation rate is not automatically good if it comes from an agent silently proceeding on low confidence rather than escalating appropriately — these two metrics must be read together, never in isolation.
- **Acceptance Rate** — how often a human accepts an agent's recommendation/draft as-is.
- **Latency** — response time per agent, per interaction.
- **Satisfaction** — Customer/Provider/Staff-reported satisfaction with the agent's assistance, where applicable.
- **Accuracy** — correctness of factual claims and calculations an agent references (never generates independently for financial data, per §8).

## 16. Future Evolution

Directional only, none committed for V1, each requiring its own RFC/specification before work begins, consistent with `AI_STRATEGY.md` §10's own framing:

- **Specialized Agents:** Narrower agents splitting off from the seven specified above as real usage patterns justify it (e.g. a dedicated Booking-flow agent separate from the general Customer Assistant).
- **Voice Agent:** A bilingual voice-interaction agent, per `AI_STRATEGY.md` §10 — contingent on native app development (`PRODUCT_REQUIREMENTS.md` §12).
- **WhatsApp Agent:** A conversational agent operating directly within WhatsApp (BARQ's primary Notifications channel, `TECH_STACK.md` §10) rather than only the in-app Customer Assistant — a natural extension given WhatsApp's centrality to BARQ's Communication stack.
- **Manager Agent:** A coordinating agent overseeing handoffs between the other agents (§11) as multi-agent collaboration matures (`AI_STRATEGY.md` §10) — this is the most architecturally significant future item in this list, since it would be the first agent whose "customer" is other agents rather than a human directly; it would still be bound by `ADR-0008` in full, including never accumulating authority the individual agents it coordinates don't already have.
- **RAG:** Per §10's Knowledge Assistant note — contingent on a future Vector Store/Knowledge Base.
- **MCP:** Per `AI_STRATEGY.md` §10/`TECH_STACK.md` §11 — a candidate future mechanism for structured, governed AI-to-tool interaction.

## 17. Anti-Patterns

Explicitly forbidden, without exception, across every agent in this document:

- Never impersonate humans — per `ADR-0008` point 11 and `AI_STRATEGY.md` §2's Transparent Automation.
- Never hide uncertainty — per §14's Confidence requirement; presenting a low-confidence output as settled fact is a defect, not an acceptable optimization trade-off.
- Never bypass `ADR-0008` — no agent specification in §4–§10 grants a capability that ADR forbids, and no future revision of this document may either without a superseding ADR.
- Never execute forbidden actions — the specific absolute prohibitions per agent (§6's "never dispatch autonomously," §8's "never approve payouts, never modify balances," §9's "never change configuration") are restatements of `ADR-0008`, not independent rules that could be interpreted more loosely than the ADR itself.
- Never fabricate knowledge — per §10's Knowledge Assistant behavior and `AI_STRATEGY.md` §2's "AI Learns From Approved Knowledge Only" — this applies to every agent, not only the Knowledge Assistant specifically.

## 18. Open Decisions

Intentionally deferred — not invented here:

1. **Detailed specifications for Marketing Assistant, Documentation Assistant, and Developer Assistant** (named in `AI_STRATEGY.md` §3, not elaborated in this document) — deferred to a future revision of this document, not decided now.
2. **Manager Agent design** (§16) — directional only; no specification exists.
3. **RAG/MCP adoption timing** (§16) — contingent on infrastructure (Vector Store, per `DATABASE_DESIGN.md` §13/§19) not yet built.
4. **Specific escalation SLA thresholds** (e.g. what confidence score triggers escalation, §13) — a tuning decision appropriately deferred past this document's architecture-level scope.
5. **Whether the Operations Assistant's "alert precision" KPI (§6, §15) needs a formally defined measurement methodology before launch, or can be refined post-launch** — flagged, not decided.
6. **Voice Agent and WhatsApp Agent (§16) sequencing relative to each other** — both directional, no relative priority set.

---

## Related Documents
- `AI_STRATEGY.md` — §2–§10, the strategy this document specifies against; not duplicated, only elaborated for the seven agents detailed here
- `ADR-0008-ai-agent-boundaries.md` — the permanent governance every agent's Permissions section complies with; the authoritative source this document never contradicts
- `PROJECT_MANIFEST.md` §7, `ARCHITECTURE_PRINCIPLES.md` Principle 8/23 — the founding commitments both `AI_STRATEGY.md` and this document operationalize
- `DOMAIN_MODEL.md` — the AI Bounded Context and every other context an agent above reads from
- `SYSTEM_ARCHITECTURE.md` — §4–§6, §11–§12 — the AI Layer's architectural isolation and the Event Bus/Message Bus status referenced in §11
- `DATABASE_DESIGN.md` §13, `API_CONTRACTS.md` §13, `DESIGN_SYSTEM.md` §17 — AI data strategy, AI API principles, and AI interface requirements this document's agents must satisfy
- `BUSINESS_MODEL.md` §4 — the value propositions §2 ties each agent's purpose back to
- `KPIS.md` *(not yet written)* — will own specific numeric targets for §15's KPI categories

## Open Questions
1. Should this document be revised now to add Marketing/Documentation/Developer Assistant specifications, or is a future, separate revision the right sequencing? Flagged as Open Decision #1, not resolved here.
2. §11 states BARQ has no formal cross-agent message bus today, deliberately consistent with `SYSTEM_ARCHITECTURE.md` §11's Event Bus being a future item — should this document's own future revision, if a formal Event Bus is adopted, be triggered automatically, or handled independently? Flagging the dependency rather than assuming an answer.

## Future ADR References
- Any future agent role added to this document, or any expansion of an existing agent's Permissions beyond what's specified in §4–§10, must be checked against `ADR-0008` before being written — if it would require an exception to that ADR, a superseding ADR is required first, not a routine revision of this document.
- The Manager Agent (§16), if and when specified in detail, is a strong candidate for its own dedicated ADR given its coordinating role across other agents — flagged here as a recommendation, not a current requirement.
