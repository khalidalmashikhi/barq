# ADR-0017 — Configurable Provider Verification Requirements (Level 2)

- **Purpose:** Make the SET of provider verification requirements/document types — and which are required per provider type — **admin-configurable data** (managed from the Admin Panel) instead of a hard-coded code map, so introducing or retiring a provider requirement never needs a code deployment. Records the schema, the stable-key strategy, the fail-closed failure mode, and the deactivation / policy-change / already-approved semantics.
- **Scope (this ADR):** the additive schema (`ProviderVerificationRequirement` model + `VerificationRequirementAudience` enum), the fail-closed policy-resolution contract (`src/lib/provider-document-types/policy.ts`), and the design of Admin CRUD / provider-UX / seeding to be built in **later, separately-approved gates**.
- **Out of Scope (unchanged, not touched here):** BR-029 *enforcement* (`assertProviderApprovable` stays code and always runs); the provider authorization model (`requireProvider`/`requireApprovedProvider`, the `/provider/*` layout gate, the `resolveCustomerNavOptions` doorway — all confirmed correct, preserved); booking/pricing/payment; taxonomy/ADR-0016; `regionCode`/`pricingUnit`; BR-028; Vehicle/Asset; Dynamic Fields; OAuth. This gate implements **schema + migration + this ADR + the pure fail-closed primitive only** — no Admin CRUD, no provider-UX wiring, no seed execution, no DB mutation.
- **Dependencies:** `ADR-0015` (code-registry-not-enum convention it reuses), `ADR-0005` (bilingual JSON labels), `ADR-0008` (AI boundaries), `11-SECURITY-POLICY.md` (the code-vs-admin dividing line), BR-029 (`16-BUSINESS-RULES.md`).
- **Status:** Accepted (schema/design gate). Admin CRUD and provider-UX wiring are deferred to follow-up gates.
- **Owner:** Khalid Al-Mashikhi (Platform Owner).

---

## Context

Provider verification today is code-owned in three layers: the document-**type** vocabulary (`src/lib/provider-document-types/registry.ts` — `IDENTITY_PROOF`/`COMMERCIAL_REGISTRATION`/`TOURISM_LICENCE`, a registry-validated String on `ProviderDocument.type`, no enum/CHECK), the **requirement map** (`requirements.ts` — hard-coded `INDIVIDUAL→IDENTITY_PROOF`, `COMPANY→COMMERCIAL_REGISTRATION`), and **enforcement** (`assertProviderApprovable` blocks approval until every required doc is `APPROVED`). Adding a new requirement therefore needs a code deploy. The platform owner wants requirements to be genuine admin-managed data (**Level 2**), while keeping enforcement code-authoritative.

`11-SECURITY-POLICY.md`'s dividing line: staff *may* control **what happens** (a commission %, a category's visibility) as long as the **enforcement code still runs and validates**; they must never control **whether a check runs**. Verification *requirements* are "what happens" data; **BR-029 enforcement** is "whether a check runs" and stays code — the same split as "admin sets 10% for category X, but the code that applies + snapshots it stays code."

## Decision

**1. New model (additive).** `ProviderVerificationRequirement` (table `provider_verification_requirements`):

| field | type | notes |
|---|---|---|
| `id` | `UUID` (`uuid(7)`) | PK, repo convention |
| `key` | `String @unique` | **stable code**, immutable after creation; what `ProviderDocument.type` references |
| `name` | `Json` | bilingual `{ar,en}` (ADR-0005) |
| `description` | `Json?` | bilingual instructions, nullable, presentation only |
| `appliesTo` | `VerificationRequirementAudience` | `INDIVIDUAL` / `COMPANY` / `BOTH` |
| `required` | `Boolean @default(false)` | required (BR-029 blocker) vs optional; **new rows default optional** |
| `active` | `Boolean @default(true)` | active/inactive |
| `sortOrder` | `Int @default(0)` | admin display order |
| `createdAt`/`updatedAt` | `Timestamptz(6)` | repo convention |

Indexes: `@@unique(key)`, `@@index([active])`. New enum `VerificationRequirementAudience { INDIVIDUAL COMPANY BOTH }` (a genuinely fixed set → a Prisma enum is correct; the growing *key* set stays a String, so a new requirement needs no migration).

**2. `ProviderDocument.type` stays a String soft-reference to `key` — NOT a relational FK.** Rationale (compatibility over normalization, per the platform-owner directive): existing `provider_documents.type` values already equal the intended keys, so **no backfill** and **no orphaning**; a requirement is never hard-deleted (deactivate-only), so no cascade/`Restrict` hazard; and label/description edits never touch the key, so a document's validity is independent of presentation. A hard FK would force a backfill, couple document validity to a requirement row, and add cascade risk for zero real benefit here.

**3. Enforcement stays code (BR-029).** `assertProviderApprovable` continues to decide *whether* approval is allowed and always runs; the new table only changes *which* keys it treats as required (via the resolver below). An admin editing config can never bypass the gate.

**4. Fail closed.** `src/lib/provider-document-types/policy.ts` (`resolveRequiredKeysFromPolicy`) is the pure, tested primitive the future DB path uses: `policyRows === null` (DB read failure) **or** `[]` (unseeded) → fall back to the **code-default required set** (non-empty), **never "require nothing"**; a non-empty policy is the admin's authoritative configuration (even zero-required is a deliberate choice, enforced honestly — the gate still runs and finds no blockers). The fallback being non-empty is what makes the failure *closed*.

## Semantics (explicitly designed; implemented in later gates)

- **Stable-key strategy (E/§9):** `key` is immutable after creation (admin write path will reject key changes, same convention as `FeatureFlag.key`/`HomepageSection.key`). `name`/`description`/`appliesTo`/`required`/`active`/`sortOrder` are freely editable. A key with existing `ProviderDocument` references can never be re-keyed (would orphan history); only its labels/flags change.
- **`ProviderDocument` compatibility (§3/§8):** unchanged model; existing rows remain valid because the seed uses the exact existing keys.
- **Deactivation (§10):** `active=false` removes a requirement from the required/optional checklist going forward; **historical `ProviderDocument` rows are never deleted or rewritten** — they persist with their `type` and `status` for audit/history.
- **Optional→required / required→optional / new required / audience change (§10):** all take effect for **future** blocker computations (the active policy at the moment `assertProviderApprovable` runs); they never rewrite documents. A brand-new *required* requirement defaults to optional on creation, so creating one can't retroactively block anyone until an admin flips `required`.
- **Already-approved providers (§11):** an APPROVED provider is **never auto-demoted** when policy tightens later — `Provider.status` is only changed by explicit admin actions (approve/reject/suspend). Blocker computation uses the *current* active policy for *pending* approvals; re-verification of already-approved providers (e.g., a "policy changed — re-review" queue) is a **future gate**, deliberately not invented here (no automatic suspension).
- **Fail-closed (§5):** designed above and unit-tested in `policy.test.ts` (null → defaults, empty → defaults, non-empty authoritative, closed-failure invariant).

## Future Admin CRUD & Audit (design only — L/M)

- **Admin section** "Provider Verification Requirements" on the existing admin CRUD pattern (Categories/Feature-Flags style): list + create + edit + activate/deactivate + reorder, with AR/EN name + description, applies-to, required/optional, active, sort order; AR/EN + RTL.
- **Auditability (§12):** every mutation records an `AuditLog` entry **in the same transaction** (established `recordAuditEvent` pattern) — distinct `action` values (`provider_verification_requirement.created` / `.activated` / `.deactivated` / `.required_changed` / `.applicability_changed` / `.labels_changed` / `.reordered`), `entityType: "ProviderVerificationRequirement"`, `entityId`, and `previousValue`/`newValue`. The schema imposes no obstacle to this.
- **Seeding:** the default rows (`IDENTITY_PROOF`/INDIVIDUAL/required, `COMMERCIAL_REGISTRATION`/COMPANY/required, `TOURISM_LICENCE`/BOTH/optional) are seeded by a later `APP_ENV=staging`-guarded, idempotent bootstrap (same convention as ADR-0016), preserving today's behavior exactly. **An INDIVIDUAL is never required to provide Commercial Registration** unless an admin explicitly configures it.

## Consequences

**Positive:** new provider requirements need no code deploy; compliance policy becomes admin-managed and auditable; enforcement + fail-closed stay code-authoritative; zero change to existing tables/documents; safe, reversible evolution.

**Negative / Cost:** a genuine security-posture shift (requirements move from code-controlled to admin-config) — mitigated by keeping enforcement code, failing closed, and defaulting new requirements to optional. Two sources of truth exist transiently (code default + DB) until the resolver wiring gate; the code default remains the fail-closed fallback, so this is a feature, not drift.

## Alternatives considered (rejected)

- **Level 1 (rules in DB, types stay code):** rejected by the platform owner — it still needs a code change to introduce a new *type*.
- **Relational FK `ProviderDocument.requirementId`:** rejected — forces a backfill, couples document validity to a requirement row, and adds cascade risk; the String soft-reference is safer and compatible.
- **Seeding inside the migration:** rejected — matches ADR-0016's separation (structure via migration, data via guarded idempotent bootstrap).
- **Auto-suspend already-approved providers on policy tightening:** rejected — punitive and out of scope; re-verification is a future, human-in-the-loop gate.

## Related

`ADR-0015`, `ADR-0016`, `ADR-0005`, `ADR-0008`; `11-SECURITY-POLICY.md`, `16-BUSINESS-RULES.md` (BR-029); `src/lib/provider-document-types/{registry,requirements,policy}.ts`, `src/lib/provider/documents/assert-provider-approvable.ts`.
