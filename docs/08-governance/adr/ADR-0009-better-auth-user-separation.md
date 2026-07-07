# ADR-0009: Better Auth User Model Separation (Option B)

- **Purpose:** Record the decision to give Better Auth its own infrastructure-owned user model, separate from BARQ's domain `User`, resolving the runtime conflict discovered when Better Auth's `user.create()` call required fields (`name`, `email`, `emailVerified`) that BARQ's domain `User` does not and should not have.
- **Scope:** The relationship between Better Auth's internal user concept and BARQ's domain `User`; the ownership boundary between `Session`/`Account`/`Verification` (already Better-Auth-owned, per `ADR-0006`'s Entry 046 correction) and BARQ's domain entities; the linking mechanism between the two user concepts.
- **Out of Scope:** The actual schema edit (not performed by this ADR — analysis and decision only, per instruction), the reconciliation logic implementation, any code.
- **Dependencies:** `ADR-0006-database-baseline.md` (UUID v7 strategy for BARQ's own primary keys — this ADR is written specifically to preserve that decision's integrity, not weaken it), `AUTHENTICATION.md` (phone-only, no-email-collection design), `DOMAIN_MODEL.md` (`User` entity definition and its own unresolved Open Question #1 on role exclusivity), `DEVELOPMENT_LOG.md` Entries 043–046 (the trail of findings that led here — this ADR is the architectural resolution of what those entries progressively surfaced).
- **Status:** Draft v0.1 — Architecture Review pending.
- **Owner:** CTO / Principal Software Architect (BARQ core team).

---

## Context

Entry 046 already established that `Session`, `Account`, and `Verification` are Better-Auth-owned infrastructure whose primary keys must not be constrained to BARQ's UUID v7 convention, since Better Auth supplies its own ID values for them directly. That fix was necessary but incomplete: it addressed the *primary key format* mismatch without addressing the deeper fact underneath it — **Better Auth's Prisma adapter assumes it fully owns the shape of the "user" table it writes to**, not just the three tables already recognized as its own.

The subsequent runtime error (`Unknown argument 'name' in prisma.user.create()`) confirmed this: Better Auth's `signUpOnVerification` flow calls `user.create()` with `id` (its own generator, non-UUID), `name`, `email`, `emailVerified`, plus `phoneNumber`/`phoneNumberVerified` from its phone plugin — unconditionally, regardless of which sign-in method is active or whether `emailAndPassword` is disabled. `getTempEmail` (configured in the "Phone OTP Schema Support" sprint) supplies *where the email value comes from*; it does not remove the requirement that an `email` column exist to receive it. The same is true of `name` and `emailVerified`.

Three options were evaluated (full analysis in the prior turn's response, not repeated here per SSOT):
- **Option A** — adapt BARQ's `User` to Better Auth's expected shape.
- **Option B** — give Better Auth its own separate user table, linked to BARQ's `User`.
- **Option C** — customize Better Auth's adapter/hooks to force it to use only BARQ's fields.

**Option B is approved.**

## Decision

1. **Better Auth receives its own infrastructure-owned user model**, provisionally named `AuthUser`, matching Better Auth's actual required shape in full: a Better-Auth-supplied `id` (non-UUID, same pattern already established for `Session`/`Account`/`Verification` in Entry 046), `name`, `email`, `emailVerified`, `phoneNumber`, `phoneNumberVerified`, and Better Auth's own timestamp conventions. This model exists purely as an Anti-Corruption Layer boundary — it holds exactly what Better Auth needs to function and nothing BARQ's domain reasons about directly.

2. **BARQ's domain `User` remains completely unchanged in shape**: `id` stays UUID v7 per `ADR-0006`, no `name`/`email`/`emailVerified`/`image` is added, and it remains the sole Identity entity `DOMAIN_MODEL.md` and every other document already depends on. `User` continues to be what BARQ's own business logic, Audit Log, and every Customer/Provider/Staff/Admin relation reasons about — never `AuthUser`.

3. **`Session` and `Account`'s `userId` foreign keys move from referencing BARQ `User.id` to referencing `AuthUser.id`.** This is a correction to Entry 046, not a reversal of it — Entry 046 correctly identified these three models as Better-Auth-owned for primary-key purposes but did not yet have the information (surfaced only by this runtime error) to recognize that their foreign key should point at Better Auth's own user concept too, not BARQ's. `Verification` is unaffected here, since it was never user-linked in the first place (identifier-keyed, per its original design in the schema-support sprint).

4. **BARQ `User` gains a single new, nullable, unique link field** referencing `AuthUser` — nullable specifically because a `User` can exist with no authentication ever having occurred (Staff-Assisted Booking, per `DOMAIN_MODEL.md`'s own documented exception), and unique because the relationship is one-to-one: one BARQ identity, at most one Better Auth authentication record.

## Why BARQ User Remains Domain-Owned

`DOMAIN_MODEL.md` established `User` as the base Identity entity every other Bounded Context extends (`Customer`, `Provider`, `Staff`, `Admin`) and every Audit Log entry attributes actions to. Letting an authentication vendor's internal schema requirements dictate that entity's shape would invert this project's own dependency direction: `ARCHITECTURE_PRINCIPLES.md` Principle 6 (Modular Monolith) and Principle 24 (Business Rules Belong to the Domain Layer) both hold that infrastructure serves the domain, not the reverse. `AUTHENTICATION.md` §2's Privacy by Design principle is explicit that only a phone number is required to authenticate — permanently adding `name`/`email` fields to the domain `User` merely because a specific, swappable auth library wants them would contradict that principle for the lifetime of the field, long after any specific auth vendor decision might change.

## Why Session/Account/Verification Should Reference AuthUser, Not BARQ User

These three models do not represent BARQ business facts — they represent Better Auth's own bookkeeping about its own authentication mechanics (a session token, a linked credential, a verification code). A foreign key models an ownership/reference relationship; pointing Better Auth's own infrastructure records at BARQ's domain `User` would blur exactly the boundary this ADR exists to draw, and would leave BARQ's domain `User` implicitly coupled to Better Auth's referential integrity requirements (cascade deletes, etc.) for data BARQ's domain doesn't actually own. Referencing `AuthUser` keeps the coupling contained entirely within the Better-Auth-owned side of the boundary.

## How BARQ User Links to AuthUser

Via the single nullable, unique field on `User` described in Decision point 4 — a one-to-one, optional relationship. **Reconciliation logic (which side creates first, and how the link gets established) is explicitly not decided by this ADR** — see Open Questions.

## Why This Preserves ADR-0006 and AUTHENTICATION.md

`ADR-0006`'s UUID v7 requirement was stated as "no exception, no model-specific deviation" for BARQ's own domain entities — `AuthUser` is not a BARQ domain entity, so it was never within that requirement's scope to begin with (the same reasoning `ADR-0006` itself already applied to third-party-supplied identifiers, and the same reasoning Entry 046 already established for `Session`/`Account`/`Verification`). `AUTHENTICATION.md`'s phone-only design is preserved exactly because `AuthUser`'s `email`/`name` fields — even though they exist as columns — are never collected from or shown to a BARQ user; `getTempEmail` continues to populate them synthetically, and no BARQ product surface ever asks a person for this data. The separation is precisely what makes both documents' commitments enforceable without an exception.

## Alternatives Considered

- **Option A — Adapt BARQ `User` to Better Auth's shape:** Rejected. Requires either reopening `ADR-0006`'s ID strategy for a reason external to BARQ's own architecture, or permanently carrying `name`/`email` fields on the domain Identity entity that `AUTHENTICATION.md` deliberately excludes. Also the most invasive to reverse later if BARQ ever changes auth vendors.
- **Option C — Custom adapter/hooks forcing Better Auth to use only BARQ's fields:** Rejected. The correct instinct (keep the domain model clean) reached through the wrong mechanism — deep, unverified customization of a third-party library's internal adapter contract, fragile against upstream changes, and in tension with `ARCHITECTURE_PRINCIPLES.md` Principle 17 (Simplicity over Cleverness) and this project's standing preference for Better Auth's built-in capabilities over custom reimplementation.

## Consequences

**Positive:** BARQ's domain `User` and `DOMAIN_MODEL.md`'s Identity Bounded Context remain exactly as specified, with zero compromise for a vendor integration detail. The Better Auth boundary is now fully and consistently contained (`AuthUser` joins `Session`/`Account`/`Verification` under the same ownership pattern), rather than partially contained as it was after Entry 046 alone.

**Negative / Cost:** Two "user" concepts now exist in the codebase, requiring clear, consistent documentation and naming discipline so future engineers (human or AI) don't conflate them — the existing `Session`/`Account`/`Verification` commenting pattern already establishes the precedent to extend. Reconciliation logic (Open Questions, below) is genuine new design work, not yet scoped in detail.

**Follow-up Required:** The schema change described in Decision points 1, 3, and 4 must be implemented in a dedicated, reviewed change — not performed by this ADR. Reconciliation logic must be designed before that implementation is considered complete, not deferred indefinitely as an unstated assumption.

## Migration Implications

- **New model, new table:** `AuthUser` (or whatever name is confirmed) is a net-new table — additive, low migration risk on its own.
- **Foreign key retargeting on `Session`/`Account`:** this is the higher-risk part of the migration. Any `Session`/`Account` rows created since Entry 046's fix currently reference BARQ `User.id` values; retargeting their `userId` column to reference `AuthUser.id` instead is not a pure additive change if any such rows already exist in a real database — this needs an explicit data-migration/backfill decision, not just a schema-migration one, before it is executed. In a development environment with disposable data, this is low-stakes; in any environment with real accumulated sessions, it is not, and `DEPLOYMENT_AND_INFRASTRUCTURE.md` §9's Business Continuity ordering (Authentication/Booking first) makes this exactly the kind of change that needs care in a non-development environment.
- **BARQ `User`'s new link field:** additive, nullable — low risk.

## Open Questions

1. **Reconciliation order:** when a phone number verifies for the first time, does `AuthUser` get created first and BARQ `User` second (with the link established immediately after), or does BARQ's `User` need to be checked/created first (e.g. because a Staff-Assisted Booking already created one for that phone number) with `AuthUser` then linked to it? This determines real application-layer flow, not just schema shape, and is not decided here.
2. **Existing phone-number collision:** if a BARQ `User` already exists for a phone number (via Staff-Assisted Booking) and that same phone number later completes real OTP verification for the first time, how does the system recognize this is the *same* identity rather than creating a second, disconnected `User`? This is closely related to `DOMAIN_MODEL.md`'s own still-open Question #1 (User role exclusivity) and may need to be resolved alongside it, not independently.
3. **`AuthUser` naming:** "AuthUser" is used throughout this ADR as a working name, not a final one — confirm before implementation.
4. **Who owns writing the reconciliation logic, and where architecturally** (Application Layer service, a Better Auth lifecycle hook, or elsewhere) — not decided here, a question for the implementation step that follows this ADR.
5. **Retention/cleanup of `AuthUser`** if a corresponding BARQ `User` is ever deactivated — not addressed by this ADR, deferred to whichever future document eventually owns account-deactivation policy in full.

---

## Related Documents
- `ADR-0006-database-baseline.md` — the UUID strategy this ADR confirms remains intact for BARQ's own entities
- `AUTHENTICATION.md` — the phone-only design this ADR's separation preserves
- `DOMAIN_MODEL.md` — the `User` entity and its own Open Question #1, directly relevant to this ADR's Open Question #2
- `DEVELOPMENT_LOG.md` Entries 043–046 — the sequence of findings that led to this decision, referenced not repeated
- `ARCHITECTURE_PRINCIPLES.md` Principles 6, 17, 24 — the principles this decision is reasoned from

## Future ADR References
- The actual schema implementation of this ADR's Decision section should be recorded as its own `DEVELOPMENT_LOG.md` entry when performed, referencing this ADR — it does not itself need a superseding ADR, since it is this ADR's direct, approved implementation, not a new decision.
- Resolution of Open Question #2 (phone-number collision / identity reconciliation), if it changes how `DOMAIN_MODEL.md`'s Open Question #1 gets answered, may itself warrant updating that document and should be tracked back to this ADR when it happens.
- Any future decision to change `AuthUser`'s shape, or to move away from Better Auth entirely (which would let this whole separation be reconsidered), requires a superseding ADR to this one.
