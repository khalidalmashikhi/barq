# BARQ Authentication

- **Purpose:** Define BARQ's authentication architecture — how users prove their identity. This document does not define authorization, permissions, or implementation.
- **Scope:** Authentication principles, actors, methods, session strategy, identity verification responsibilities, device management, security controls, AI authentication rules, user experience, and future evolution.
- **Out of Scope:** Authorization and permissions (owned by future `IDENTITY_AND_ACCESS.md`, referenced not redefined), RBAC, API endpoints, implementation, code.
- **Dependencies:** `PROJECT_MANIFEST.md` (Customer Promise §9 — booking "as fast as messaging a friend"), `SYSTEM_ARCHITECTURE.md` (§4, §6, §12 — Identity module and the Application Layer authorization boundary this document's output feeds into), `TECH_STACK.md` §6 (Authentication Stack — this document resolves what that section left Proposed), `DOMAIN_MODEL.md` (Identity Bounded Context, `User` entity and its Staff-Assisted Booking invariant), `AI_STRATEGY.md` §4, `ADR-0008-ai-agent-boundaries.md` (points 1–2, 11, 17 — governing §9 in full), `AI_AGENTS.md`, `DESIGN_SYSTEM.md` §11 (OTP form pattern, referenced not redefined), `API_CONTRACTS.md` §9 (which this document now fulfills — that section should be cross-checked against this one, per Open Questions).
- **Status:** Approved v1.0 — Locked. Batch-approved via `ARCHITECTURE_FREEZE_V1.md`. Future changes only via ADR, per `PROJECT_RULES.md` §10 and §4.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## 1. Executive Summary

BARQ's authentication exists to make proving identity feel as fast as the booking experience it protects — consistent with `PROJECT_MANIFEST.md`'s Customer Promise that booking should feel "as fast as messaging a friend." Authentication is phone-number-and-OTP-based, passwordless from day one, and deliberately accommodates the one genuine exception this platform has always carried: a Customer who never authenticates at all, because a Staff member created their record and Booking on their behalf (`DOMAIN_MODEL.md`'s Staff-Assisted Booking pattern). Every authenticated session feeds into the Application Layer authorization boundary already established in `SYSTEM_ARCHITECTURE.md` §6/§12 — this document produces a verified identity; it does not decide what that identity is allowed to do. The technology (`TECH_STACK.md` §6) is resolved below, now that the actual flow requirements are fully specified.

## 2. Authentication Principles

- **Simple:** One flow (phone + OTP) for every human actor at launch — no parallel authentication paths to maintain or explain.
- **Fast:** Every step is optimized for speed, consistent with `ARCHITECTURE_PRINCIPLES.md` Principle 13 applied to the very first interaction a person has with BARQ.
- **Secure:** Per `ARCHITECTURE_PRINCIPLES.md` Principle 11 — speed never comes at the expense of the security controls in §8.
- **Passwordless First:** No password to create, remember, or leak — OTP-based verification is both faster and structurally removes an entire class of credential-reuse risk.
- **Mobile First:** Designed for a phone-number-centric, mobile-first population (`ARCHITECTURE_PRINCIPLES.md` Principle 9), not adapted from a desktop-first password flow.
- **Privacy by Design:** Per Principle 12 — only a phone number is required to authenticate; no unnecessary personal data is collected at the authentication step itself.
- **AI Safe:** Governed in full by §9 — authentication is never a vector through which an AI Agent gains human-equivalent identity.
- **User Friendly:** Clear errors, visible loading states, and a real recovery path (§10) — authentication friction is treated as a design defect to fix, not a security feature to preserve.

## 3. Authentication Actors

- **Customer:** Authenticates via Phone OTP (§4), or, per the Staff-Assisted Booking exception (`DOMAIN_MODEL.md`), does not authenticate at all — a Staff member authenticates as *themselves* and acts on the Customer's behalf, with every such action attributed to that Staff member, never to a fictional "authenticated" Customer session.
- **Provider:** Authenticates via Phone OTP, same mechanism as Customer — Provider *business* verification (Approval gate, `DOMAIN_MODEL.md` Provider lifecycle) is a separate concept entirely, owned by the Provider and Administration contexts, not by this document; authentication confirms the individual controls the phone number, nothing more.
- **Operations Staff:** Authenticates via Phone OTP against a provisioned internal account — provisioning itself (who becomes Staff) is an Administration-context decision, out of scope here.
- **Admin:** Same mechanism as Operations Staff, provisioned with the Admin role.
- **AI Agents:** Never authenticate as any of the above — governed in full by §9.
- **System Integrations:** Future third-party integrations (e.g. a future Partner API, `API_CONTRACTS.md` §3) would authenticate via a service-level credential distinct from any human OTP flow — not part of V1 scope, flagged in §13.

## 4. Authentication Methods

- **Phone OTP (Approved, Launch):** The sole authentication method for every human actor in §3 at launch. *Why:* matches Oman/GCC's phone-number-centric mobile usage; passwordless (§2); directly enables the Staff-Assisted Booking pattern, since a phone number is the one piece of identity a Staff member can act on without the Customer present.
- **Email OTP (Future):** A candidate secondary method, likely most relevant for Staff/Admin actors who may also operate from a desk with an email identity — not required by any V1 persona's real usage pattern (`PRODUCT_REQUIREMENTS.md` §4).
- **Passkeys (Future):** A candidate faster, more secure future method once device-level passkey support is broadly reliable across BARQ's actual user base — tracked in §11.
- **Social Login (Future):** A candidate Customer convenience option — deliberately not adopted at launch, since it would introduce a second identity-provider dependency before the primary phone-based flow is even proven.
- **Enterprise SSO (Future):** A candidate method specifically for a future Tourism Company or Enterprise partner scenario (`BUSINESS_MODEL.md` §6's Enterprise Solutions) — not relevant to any V1 persona.

**Adoption Decision (resolving `TECH_STACK.md` §6):** Better Auth is confirmed as BARQ's authentication technology. The flow requirements specified in this document — self-hosted, TypeScript-native OTP verification; the Staff-Assisted Booking exception (a session created and attributed to Staff, acting on an unauthenticated Customer record); and no dependency on a third-party auth-as-a-service provider that would not natively support that exception — are exactly the requirements `TECH_STACK.md` §6 said would decide this. NextAuth remains the documented fallback if Better Auth's custom-flow support proves insufficient during implementation, but is not the current decision. This is a Technology Decision Matrix update, not a new ADR, per the governance rule established when `TECH_STACK.md` was Locked (ADRs reserved for High Reversal Cost decisions; Authentication was not among the three flagged as such in `SYSTEM_ARCHITECTURE.md` §9).

## 5. Session Strategy

- **Session Lifecycle:** Created on successful OTP verification; remains valid until expiration, explicit logout, or revocation (below).
- **Expiration:** A defined, bounded session lifetime — specific duration is an Open Decision (§13), not invented here; the requirement is that no session is valid indefinitely.
- **Refresh:** A mechanism for extending an active session without forcing a full re-authentication for a still-engaged user — specific refresh-token mechanics are an implementation detail (Out of Scope), but the requirement for a refresh path (rather than only hard expiration) is stated here.
- **Revocation:** A user (or an Admin acting on a security concern) can invalidate an active session immediately — revocation is not just "wait for expiration."
- **Device Awareness:** A session is associated with the device/context it was created on, feeding into §7's device management, without this document specifying the exact tracked attributes (an implementation detail).
- **Trusted Devices:** A candidate mechanism for reducing OTP friction on a recognized device for a returning user, balanced against §2's Secure principle — exact trust criteria and duration are an Open Decision (§13).

## 6. Identity Verification

Responsibilities only — mechanics are Out of Scope:

- **Phone Verification:** This document's actual job — confirming a phone number is real and currently controlled by the person completing the OTP flow. This is the entirety of what "authenticated" means in this document; it is not a statement about trustworthiness, business legitimacy, or any authorization level.
- **Provider Verification:** Not this document's responsibility. Owned entirely by the Provider Approval gate (`DOMAIN_MODEL.md` Provider lifecycle, Administration context authority) — a Provider can be phone-authenticated (§4) and simultaneously not yet Approved; these are independent facts, and this document does not conflate them.
- **Staff Verification:** Not this document's responsibility beyond the phone OTP mechanism itself — *who* becomes a provisioned Staff account is an Administration-context/HR-adjacent decision, out of scope here.
- **Admin Verification:** Same as Staff — this document only confirms the phone number; the decision to grant Admin provisioning is Administration's responsibility.

## 7. Device Management

- **Known Devices:** A device previously used for a successful authentication, potentially eligible for reduced friction per §5's Trusted Devices concept.
- **New Devices:** Always require full OTP verification — no exception, regardless of any other signal.
- **Risk Detection:** Unusual patterns (e.g. rapid authentication attempts from geographically implausible locations in succession) are a candidate signal for additional friction or a security flag — specific detection logic is an implementation/`SECURITY.md` concern, not defined here.
- **Suspicious Activity:** Feeds into §8's security controls and, where warranted, session termination below.
- **Session Termination:** Available to the user themselves (§5) and to Admin, for cause, consistent with `DOMAIN_MODEL.md`'s Audit Log requirement for any Admin-initiated action affecting another account.

## 8. Security Controls

- **Rate Limiting:** Applied to OTP request and verification attempts specifically, consistent with `API_CONTRACTS.md` §15's per-category rate limiting — the Public-facing OTP endpoint is exactly the kind of surface §15 already flagged as needing the strictest limits.
- **Brute Force Protection:** A bounded number of OTP verification attempts before a cooldown or block, preventing exhaustive guessing of a short numeric code.
- **OTP Expiry:** Every OTP has a short, bounded validity window — an expired OTP is never valid, regardless of framing or urgency (§12).
- **Replay Protection:** An OTP is single-use — successfully verifying it, or letting it expire, both permanently invalidate it; consistent with `API_CONTRACTS.md` §15's Replay Protection requirement.
- **Token Protection:** Session tokens are never exposed in a URL or query string, consistent with this project's standing Privacy rule against sensitive data in URLs.
- **Secrets:** OTP generation/verification logic and any related credentials are handled per `PROJECT_RULES.md` §16 and `TECH_STACK.md` §16 — never committed to a repository, never logged in plaintext.

## 9. AI Authentication Rules

Fully governed by `ADR-0008-ai-agent-boundaries.md`, referenced here, not redefined:

- **AI Agents never authenticate as users.** No AI Agent (`AI_AGENTS.md` §4–§10) ever completes the human OTP flow, holds a human-equivalent session, or otherwise appears to the system as if it were the Customer, Provider, Staff, or Admin it is assisting — consistent with `ADR-0008` point 1 (AI Agents are application actors, never system owners) and point 11 (must always identify itself as AI).
- **AI Agents always use service identity.** Every AI Agent's access to a governed Application Layer interface (`SYSTEM_ARCHITECTURE.md` §4, §12) is authenticated under its own distinct service-level identity, never borrowed from the human it is currently assisting — this is what makes an AI Agent's actions independently auditable (`ADR-0008` point 13) rather than indistinguishable from the human's own activity in a shared session.
- **Human accountability required.** Per `ADR-0008` point 17 — a human remains identifiable and accountable for every interaction an AI Agent participates in; the AI Agent's service identity supplements, and never substitutes for, the human actor's own authenticated session where one exists (e.g. a Customer using the Customer Assistant is still authenticated as themselves; the Assistant's service identity is additional, not a replacement).

## 10. User Experience

- **One-Tap Login:** Wherever platform/device capability allows (e.g. auto-filled OTP codes on mobile), friction is removed automatically rather than left for the user to manually copy a code.
- **Minimal Friction:** Every step beyond entering a phone number and the OTP itself is treated as a friction cost to justify, not a default to add.
- **Clear Errors:** A failed OTP attempt states clearly what went wrong (expired, incorrect, too many attempts) without exposing internal mechanics (§12) — consistent with `DESIGN_SYSTEM.md` §11's Forms error philosophy.
- **Loading States:** Every network-dependent step (requesting an OTP, verifying it) shows clear feedback, consistent with `DESIGN_SYSTEM.md` §14's Motion/Loading principles.
- **Recovery Flow:** A defined path for a user who has lost access to their registered phone number — specific mechanics are an Open Decision (§13), but the requirement that a recovery path exists, rather than leaving a locked-out user with no option, is stated here.

## 11. Future Authentication

Directional only, none committed for V1:

- **Passkeys:** Per §4 — contingent on broad, reliable device support across BARQ's actual user base.
- **Biometrics:** Typically device-native, layered on top of a Passkey-style flow rather than a separate BARQ-built mechanism — contingent on native app development (`PRODUCT_REQUIREMENTS.md` §12).
- **Enterprise Login:** Per §4's Enterprise SSO — contingent on real Enterprise/Tourism Company demand materializing (`BUSINESS_MODEL.md` §6).
- **Government Identity Integration:** A candidate future integration with Oman or GCC national digital identity systems, which could strengthen Provider/Customer trust signals (`BUSINESS_MODEL.md` §10) — genuinely speculative at this stage, named here only to acknowledge the possibility without committing to it, consistent with Cost-Aware Architecture applied to future planning itself.

## 12. Anti-Patterns

Explicitly forbidden, without exception:

- Never store OTP in plaintext — even short-lived, an OTP is a credential and is handled per §8's Secrets requirement.
- Never authenticate AI as a human — per §9, absolute, no exception for convenience or urgency.
- Never bypass authentication — the Staff-Assisted Booking pattern is not a bypass; the Staff member is fully authenticated as themselves (§3, §6) — there is no path in this document where any actor performs a consequential action with no authenticated identity attached to it at all.
- Never reuse expired OTP — per §8's Replay Protection, an expired or already-used OTP is never valid again under any circumstance.
- Never expose authentication internals — error messages (§10) and any observability output describe what happened at a level a user or operator needs, never internal implementation detail that could aid an attacker.

## 13. Open Decisions

Intentionally deferred — not invented here:

1. **Specific session expiration and refresh durations** (§5) — a tuning decision appropriately deferred past architecture-level documentation.
2. **Trusted Device criteria and duration** (§5, §7) — deferred; balances friction reduction against §2's Secure principle, not yet resolved.
3. **Specific OTP length and expiry window** (§8) — deferred to implementation-level specification.
4. **Recovery flow mechanics** for a lost/changed phone number (§10) — the requirement for a recovery path is stated; the mechanism (e.g. alternate verification, Staff-assisted recovery) is not decided here.
5. **System Integrations' service-credential mechanism** (§3) — not part of V1 scope; deferred until a real integration need exists.
6. **Government Identity Integration timing** (§11) — genuinely speculative, no timeline.

---

## Related Documents
- `PROJECT_MANIFEST.md` §9 — the Customer Promise this document's speed/simplicity principles serve
- `SYSTEM_ARCHITECTURE.md` §4, §6, §12 — the Identity module and Application Layer authorization boundary this document's verified identity feeds into
- `TECH_STACK.md` §6 — resolved by this document's §4 Adoption Decision; that document's Decision Matrix should be updated to reflect Better Auth as Approved
- `DOMAIN_MODEL.md` — Identity Bounded Context, `User` entity, and its Staff-Assisted Booking invariant, which this document's §3/§6 are built directly on top of without contradiction
- `AI_STRATEGY.md` §4, `ADR-0008-ai-agent-boundaries.md` points 1–2, 11, 13, 17, `AI_AGENTS.md` — governing §9 in full
- `DESIGN_SYSTEM.md` §11 — the OTP form/UX pattern this document's §10 defers detailed presentation to
- `API_CONTRACTS.md` §9 — states it would be revisited once this document existed; see Open Questions
- `IDENTITY_AND_ACCESS.md` *(not yet written)* — owns authorization/permissions entirely; this document does not encroach on that scope

## Open Questions
1. `API_CONTRACTS.md` §9 explicitly deferred to this document — should that section now be revised to confirm consistency (e.g. its statement about the Staff-Assisted Booking exception matches §3/§6 here exactly), or is a one-way reference sufficient? Flagged rather than assumed.
2. `TECH_STACK.md` §6's Decision Matrix entry for Better Auth/NextAuth should be updated to Approved given this document's §4 Adoption Decision — should that update happen now, in a dedicated pass, or wait until this document itself is Approved? Flagging the dependency; not actioned in this document.
3. Should Staff and Admin eventually use a distinct authentication method from Customer/Provider (e.g. Email OTP, given they operate from a desk), rather than sharing the same Phone OTP flow at launch? Not decided here — flagged for consideration once real Staff/Admin usage patterns are observed.

## Future ADR References
- Any future adoption of Passkeys, Social Login, Enterprise SSO, or Government Identity Integration (§11) as a committed feature (not merely directional) requires its own specification and, if it changes the core authentication mechanism's risk profile materially, an ADR.
- Any future decision to grant AI Agents a broader identity model than the service-identity approach in §9 requires a superseding ADR to `ADR-0008`, not a routine update to this document.
