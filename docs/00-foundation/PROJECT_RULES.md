# BARQ Project Rules

- **Purpose:** Define **how** BARQ is designed, documented, reviewed, approved, implemented, and maintained. This document operationalizes the philosophy in `PROJECT_MANIFEST.md` into concrete, enforceable rules of engineering practice.
- **Scope:** Documentation process, ADR/RFC process, review gates, feature and document lifecycles, Git/branch/commit conventions, code review, testing, security, performance, accessibility, bilingual requirements, AI integration rules, modular monolith and DDD rules, naming conventions, breaking-change policy, release policy.
- **Out of Scope:** *Why* BARQ exists or what it values — that is `PROJECT_MANIFEST.md`, referenced not repeated. Specific architecture decisions (owned by `ARCHITECTURE_PRINCIPLES.md` and individual ADRs). Specific coding style/linting (a future, much lower-level document, not this one — this is not a style guide). Specific test plans per feature (owned by `TESTING_STRATEGY.md` and per-feature specs).
- **Dependencies:** `PROJECT_MANIFEST.md` (all rules below derive their justification from its Core Values, Engineering Philosophy §6, and Decision Framework §12), `GLOSSARY.md` (terminology), `ADR-0001` through `ADR-0005`.
- **Status:** Approved v1.0 — Locked. Future changes only via ADR, per §10 (Document Lifecycle) and §4 (ADR Process).
- **Owner:** CTO / Principal Architect (BARQ core team).

---

## 1. Documentation First

No implementation work begins without an approved document describing what is being built and why. "Approved" means the document has passed at least one Architecture Review (§6) — a draft alone is not authorization to build. If a task cannot be traced to an approved document, it does not proceed, regardless of urgency. Urgency is addressed by prioritizing which document gets written next, not by skipping the document.

## 2. Progressive Documentation

Documents are written short and focused, then matured through defined versions rather than attempted as one large final draft. Every document follows the same lifecycle (§13). No document may skip stages to reach "Approved" faster. A document that tries to cover too much is a signal to split it, not a signal to rush its review.

## 3. Single Source of Truth (SSOT)

Every fact, rule, or decision has exactly one owning document. All other documents reference it by name rather than restating it. If the same information appears fully written out in two documents, one of them is wrong and must be corrected to a reference. Reviewers must actively check for this during Architecture Review — SSOT violations are a blocking review finding, not a style note.

## 4. ADR Process

An **Architecture Decision Record (ADR)** is used when a decision changes structure, direction, or a previously recorded decision — not for routine implementation choices.

- ADRs are numbered sequentially (`ADR-0001`, `ADR-0002`, ...) and never renumbered or edited in place once Approved.
- Each ADR follows the standard document header/footer (§14) plus: Context, Decision, Alternatives Considered, Consequences.
- An ADR may only be changed by a later ADR that explicitly supersedes it. Superseded ADRs remain in the repository, marked `Superseded by ADR-XXXX`, never deleted.
- ADRs are recorded **at the decision moment**, not batched at the end of a phase — this project's own history (`ADR-0002` before `SYSTEM_ARCHITECTURE.md` existed; `ADR-0005` before the four documents it binds existed) is the working example, not an exception.

## 5. RFC Process

A **Request for Comments (RFC)** is used for proposed changes that are significant but not yet decided — where the ADR process's role is to *record* a decision, the RFC's role is to *arrive* at one when multiple reasonable options exist or stakeholder input is genuinely needed.

- An RFC states the problem, 2+ real options with tradeoffs, and a recommendation — it does not pre-decide the outcome.
- RFCs are time-boxed for comment before a decision is made.
- Every RFC that reaches a decision is closed by writing the corresponding ADR. An RFC without a resulting ADR is not a completed process.
- Not every decision needs an RFC — reversible, low-blast-radius decisions can go straight to an ADR or even a normal document edit. RFCs are reserved for decisions that are expensive to reverse.

## 6. Architecture Reviews

Every document and every ADR passes through Architecture Review before advancing lifecycle stages (§13). A review checks, at minimum:
- Does this contradict `PROJECT_MANIFEST.md` or any Approved/Locked ADR?
- Does this duplicate content owned elsewhere (SSOT violation)?
- Are Dependencies, Out of Scope, and Related Documents accurate?
- For features: are localization, security, performance, and accessibility considerations addressed (§17–§20)?
- Is the document short and focused, or does it need to be split?

Architecture Review is a gate, not a formality — a document can be sent back for revision at any stage, including from v0.2 back to v0.1 scope, if the review finds it necessary.

## 7. Definition of Ready

A feature is **Ready** to move from specification into design/architecture work only when:
1. Its capability document exists and has passed at least one Architecture Review.
2. Localization acceptance criteria are stated (per `ADR-0005`).
3. Dependencies on other domains/documents are identified and those documents exist at least in Draft form.
4. Open Questions blocking implementation (not all Open Questions — some are legitimately deferred) are resolved.

## 8. Definition of Done

A feature is **Done** only when all of the following are true — partial completion is not done, it is in-progress and should be represented as such:
1. Implementation matches the approved specification (or the specification was updated first, per §9).
2. Arabic and English both have full parity — see §18. A feature shipped in one language is not done.
3. Automated tests exist per `TESTING_STRATEGY.md` requirements and pass.
4. Security review requirements for the feature's risk level are satisfied (§17).
5. Accessibility requirements are satisfied in both languages/directions (§19).
6. Documentation is updated to reflect what was actually built — see §9, Feature Lifecycle.
7. Code review is approved per §16.

## 9. Feature Lifecycle

```
Documented (spec drafted)
   ↓
Ready (Definition of Ready met, §7)
   ↓
Designed (UX/flows, where applicable)
   ↓
Architected (fits Modular Monolith + DDD structure, §21–22)
   ↓
Implemented
   ↓
Tested
   ↓
Documentation Updated (spec reflects reality, not just intent)
   ↓
Done (Definition of Done met, §8)
```
If implementation reveals the original spec was wrong or incomplete, the specification is corrected **before** implementation continues — code does not silently diverge from its own documentation. This is the single most important rule in this section.

## 10. Document Lifecycle

Every document in this project follows exactly this lifecycle, no exceptions:

```
Draft v0.1 → Architecture Review → Draft v0.2 → Review → Approved v1.0 → Locked → (changes only via ADR)
```

- A Locked document is not edited directly. A change is proposed, reviewed, and — if accepted — recorded as an ADR that either amends or supersedes the relevant section.
- Every document states its current Status honestly at all times (§14). A document that hasn't been reviewed is never marked Approved regardless of confidence in its content.

## 11. Git Workflow

- Trunk-based development on a protected `main` branch. No direct commits to `main`.
- All work happens on short-lived feature branches, merged via reviewed pull/merge requests only.
- A branch corresponds to one feature or one fix — not a batch of unrelated changes. This mirrors the "no duplicate/overlapping ownership" principle from SSOT, applied to change sets.

### 11.1 No Direct Main Commits (explicit rule)

`main` is protected. No individual — human or AI-assisted — commits directly to `main`. All changes, without exception once the exception in §11.2 no longer applies, merge only through a reviewed pull/merge request. This applies equally to documentation and to application code; there is no informal "it's just docs" bypass once §11.2 has closed.

### 11.2 Temporary Exception — Documentation Foundation Phase

For the current documentation-foundation phase only (Phase 0 and any subsequent pure-documentation phase preceding the start of application code), direct commits to `main` are permitted **for documentation changes only**. This exception exists because the documentation set itself is still establishing the review structure that would otherwise govern it, and is a deliberate, temporary relaxation — not a precedent.

This exception closes automatically and permanently the moment application code implementation begins. From that point forward, §11.1 applies with no exception, to documentation and code alike. Closing this exception does not require a new ADR — it is a scheduled, pre-agreed transition already recorded here — but the moment it closes should be noted in `DEVELOPMENT_LOG.md` so there is a clear historical marker of when branch discipline became fully mandatory.

## 12. Branch Strategy

- `main` — always deployable, always reflects Done (§8) work only.
- `feature/<domain>-<short-description>` — e.g. `feature/wallet-provider-payout`. Domain prefix matches the Bounded Context it belongs to (per `DOMAIN_MODEL.md`, once written) so ownership is traceable from the branch name alone.
- `fix/<short-description>` — for defect fixes.
- `docs/<short-description>` — for documentation-only changes, including ADRs.
- No long-lived branches other than `main`. Branches are deleted after merge.

## 13. Commit Message Convention

Conventional Commits format: `<type>(<scope>): <description>`

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `security`.
- Scope: the Bounded Context or document affected, e.g. `feat(wallet): add payout ledger entry`, `docs(adr): record ADR-0006`.
- Breaking changes are marked with `!` after the type/scope and explained in the commit body, and must reference the governing ADR or Breaking Change record (§26).
- A commit message references the document or ADR it implements where applicable, so history is traceable back to a decision, not just a diff.

## 14. Code Review Rules

*(Applies once implementation begins — recorded now so the standard is not invented ad hoc later.)*
- No self-approval. At least one other reviewer required.
- A reviewer checks correctness, adherence to the approved spec, adherence to Modular Monolith/DDD boundaries (§21–22), bilingual completeness (§18), and absence of duplicated logic — not just "does it run."
- If a reviewer finds the underlying spec was wrong, the fix is: pause, correct the document, then resume review — not approve code that contradicts its own spec.

## 15. Testing Requirements

*(Full detail owned by the future `TESTING_STRATEGY.md`; the binding minimums here hold until that document exists and thereafter must not fall below it.)*
- No feature reaches Done (§8) without automated test coverage appropriate to its risk level — financial logic (commission, wallet, payouts) and identity/auth logic require the highest coverage bar.
- Tests validate both Arabic and English code paths where language affects behavior (e.g. formatting, RTL-dependent logic), not English only with Arabic assumed to follow.

## 16. Security Requirements

*(Full detail owned by the future `SECURITY.md`; binding minimums here hold until then.)*
- No secrets, credentials, or tokens committed to any repository, ever.
- Authentication/authorization changes require security-focused review, not just standard code review.
- Every feature touching money (Wallet, Commission, Payments, Invoicing) or personal data undergoes explicit security consideration before merge, not after an incident.

## 17. Performance Requirements

*(Full detail owned by future capability/architecture docs; binding minimum here.)*
- Performance is a design-time consideration, not a post-launch optimization pass — capacity and load expectations are stated in a feature's specification before implementation, especially for Live Tracking, Booking creation, and Notifications, which are the most latency-sensitive domains identified so far.

## 18. Bilingual Requirements (Arabic + English)

Governed in full by `ADR-0005-bilingual-architecture.md` — referenced here, not restated, per SSOT. Binding summary for this document's purpose only:
- No feature reaches Done (§8) without full Arabic/English parity.
- No UI component reaches Done without verified RTL and LTR support.
- No user-facing string is hardcoded, in any language, anywhere.
- Every feature specification includes localization acceptance criteria, per `ADR-0005` requirement 13.

## 19. Accessibility Requirements

*(Full detail owned by future `ACCESSIBILITY.md`; binding minimum here.)*
- Accessibility is verified in both Arabic (RTL) and English (LTR) — a component accessible in only one language/direction is not accessible, per `ADR-0005`'s equal-UX requirement.
- Accessibility review is part of Definition of Done (§8), not a separate, optional pass.

## 20. AI Integration Rules

*(Full detail owned by future `AI_STRATEGY.md` and `AI_GUARDRAILS.md`; binding minimum here.)*
- Every AI Agent operates within guardrails defined **before** the agent is built (per `PROJECT_MANIFEST.md` §7).
- Human-in-the-loop review is required at any point an AI Agent's action could affect money, trust, or personal data.
- AI Agents must handle Arabic and English naturally, per `ADR-0005` requirement 11 — this is a functional requirement, not a stretch goal.
- No AI Agent is granted a capability not explicitly documented in its governing specification.

### 20.1 Mandatory Human Review of AI-Generated Content

No AI-generated or AI-modified code, and no AI-generated or AI-modified documentation, is accepted into the project without explicit human review and approval. This applies without exception — including to documents in this very documentation set, produced with AI assistance under this project's own process. AI assistance is a drafting and acceleration tool; it is never a substitute for the review gates defined in §6 (Architecture Reviews) or §14 (Code Review Rules). A human reviewer's approval is what converts an AI-produced draft into something the project can rely on — not the act of generation itself.

### 20.2 Mandatory Logging of AI-Generated Changes

Every AI-generated or AI-modified document or code change is recorded in `DEVELOPMENT_LOG.md` at the time it is made — what was changed, which document(s) or code area(s), and by which process (e.g. "AI-drafted, human-approved via Architecture Review"). This is not optional bookkeeping: it is what makes AI involvement in this project auditable after the fact, consistent with the Audit Log/Activity Log distinction already established in `GLOSSARY.md`. A change without a corresponding log entry is treated as undocumented, regardless of whether it was otherwise reviewed.

## 21. Modular Monolith Rules

Governed by `ADR-0002-modular-monolith.md`, referenced here, not restated. Binding summary:
- BARQ ships as one deployable application, internally divided into modules aligned to Bounded Contexts (per `DOMAIN_MODEL.md`, once written).
- Modules do not reach into each other's internals — cross-module interaction happens through explicitly defined interfaces, the same discipline microservices would force via network boundaries, enforced here via code boundaries instead.
- A module boundary violation is a blocking code review finding, not a style preference.

## 22. Domain-Driven Design Rules

*(Full detail owned by future `DOMAIN_MODEL.md`; binding minimum here.)*
- Every module corresponds to a Bounded Context with its own ubiquitous language, defined in `GLOSSARY.md` and elaborated in `DOMAIN_MODEL.md`.
- Domain logic is language-neutral and technology-agnostic where possible — it does not know about HTTP, database rows, or UI, per Clean Architecture separation.
- No Bounded Context silently duplicates another's responsibility — if two contexts appear to need the same logic, that logic is extracted to a shared kernel or the boundary is reconsidered, not copy-pasted.

## 23. Naming Conventions

*(High-level only — detailed technical naming, e.g. code casing conventions, is a future lower-level document, not this one.)*
- All domain terms used in code, APIs, and documentation must match `GLOSSARY.md` exactly. A term not in the Glossary must be proposed and added before it is used anywhere.
- **English-only code identifiers is the official, confirmed rule** (resolved by Architecture Review; no longer open). Source code identifiers — variables, classes, functions, tables, columns, API property names — are always in English, regardless of the domain term's Arabic equivalent in `GLOSSARY.md`. Arabic and English are both used for content, UI, localization, and documentation terms; Arabic is never used for source code identifiers. This keeps `ADR-0005`'s bilingual-by-design principle correctly scoped to the presentation/content layer and out of the codebase's structural layer, consistent with §22's requirement that domain logic remain technology-agnostic and unambiguous. `ARCHITECTURE_PRINCIPLES.md`, when drafted, restates this rule as an architectural constraint rather than reopening it as a question.

## 24. Breaking Change Policy

- A breaking change is any change to a public API contract, database schema in a backward-incompatible way, or domain model that invalidates existing integrations or data.
- No breaking change ships without: (1) a governing ADR explaining why, (2) a documented migration path, (3) explicit versioning per `API_STANDARDS.md` (once written) if it affects the API layer.
- Breaking changes to Locked documents follow the same rule as any other Locked-document change (§10) — an ADR is mandatory, not optional.

## 25. Release Policy

*(Full detail owned by future `DEPLOYMENT_AND_INFRASTRUCTURE.md`; binding minimum here.)*
- Nothing reaches a release that hasn't met Definition of Done (§8) in full, including bilingual parity — there is no "ship English now, Arabic later" release path, by design, per `ADR-0005`.
- Every release is traceable to the documents and ADRs that authorized what's in it.

---

## Related Documents
- `PROJECT_MANIFEST.md` — the philosophy this document operationalizes; not duplicated here, only referenced
- `GLOSSARY.md` — canonical terminology referenced throughout (§23)
- `DEVELOPMENT_LOG.md` *(not yet written)* — now the mandatory record of every AI-generated or AI-modified change (§20.2), and of the moment the §11.2 documentation-phase exception closes
- `ADR-0001` through `ADR-0005` — referenced throughout as the decisions this document enforces
- `ARCHITECTURE_PRINCIPLES.md`, `AI_STRATEGY.md`, `DOMAIN_MODEL.md`, `TESTING_STRATEGY.md`, `SECURITY.md`, `ACCESSIBILITY.md`, `API_STANDARDS.md`, `DEPLOYMENT_AND_INFRASTRUCTURE.md` *(not yet written)* — each owns the full detail this document only summarizes as binding minimums

## Open Questions
1. §20 currently covers two related but distinct concerns under one heading: AI Agents as a *platform feature* (customer-facing/operational agents, governed long-term by `AI_STRATEGY.md`) and AI-assisted *engineering process* (this project's own use of AI to draft code/documentation, per §20.1–20.2). Worth confirming whether these should split into two named rule sets when `AI_STRATEGY.md` is written, so a reader isn't left inferring which sub-rules apply to product AI Agents versus to how the team itself works.
2. Should RFC time-box duration (§5) be a fixed number of days now, or left flexible until the team has a real cadence to calibrate against? Proposed: leave flexible for now, revisit once `BUSINESS_MODEL.md`/`ROADMAP.md` establish actual delivery cadence.
3. Should security review (§16) require a named second reviewer with security specialization, or is standard code review sufficient at current team size? Deferred to `SECURITY.md`.
4. §11.2's exception closes "the moment application code implementation begins" — should that moment be a formally declared date/milestone recorded in `DEVELOPMENT_LOG.md` in advance, or determined retroactively by whoever makes the first code commit? Proposed: formally declared, to avoid ambiguity about which commits were covered by the exception.

## Future ADR References
- Any change to the Document Lifecycle (§10), ADR Process (§4), or RFC Process (§5) themselves requires an ADR — these are the mechanisms that govern all other change, and changing the mechanism is the highest-leverage kind of change possible.
- `ARCHITECTURE_PRINCIPLES.md`, when drafted, may propose refinements to §21–22; any such refinement is recorded as an ADR, not a silent edit to this document. §23 (English-only identifiers) is now confirmed and closed, not open for silent revision — reopening it requires an ADR, not a routine documentation update.
- Closing the §11.2 temporary exception does not require an ADR (it is a pre-scheduled transition), but any request to *extend* or *reopen* it after closure would require one, since that would reverse a settled rule rather than complete a planned transition.
