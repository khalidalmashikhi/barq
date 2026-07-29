# 16 — Business Rules Registry

The official, permanent business rule registry. Every rule has a permanent ID (`BR-NNN`) that is never reused or renumbered once assigned — a rule that becomes obsolete is marked **Superseded**, never deleted or renumbered. Each rule states its **Enforcement Status** honestly: **Enforced in code** (verified against real source), **Partially enforced** (some but not all of the rule holds today), or **Target** (product direction, not yet built) — never claim enforcement that hasn't been verified against actual code.

---

### BR-001 — Providers must be approved before publishing services
**Enforcement status: Enforced in code (Phase 0 / 0.1, Foundation Hardening).** `requireApprovedProvider()` (`src/lib/auth/rbac.ts`) composes `requireProvider()` and additionally requires `status === "APPROVED"`, throwing `ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED")` otherwise. Wired into all 8 service/availability-management call sites: `create-service.ts`, `update-service.ts`, `transition-service-status.ts` (publish/unpublish/archive), `duplicate-service.ts`, `create-availability-slot.ts`, `update-availability-slot.ts`, `delete-availability-slot.ts`, `create-availability-slots-bulk.ts`. Each returns a stable `PROVIDER_NOT_APPROVED` error code (distinct from `NO_PROVIDER_PROFILE`), translated in all 8 locales (`provider.json`'s `serviceErrorProviderNotApproved` / `availabilityErrorProviderNotApproved` keys). Covered by 9 test files, 34 tests (`src/lib/provider/*.test.ts`), all passing.
**Deliberately not gated by this rule** (verified, not an oversight): read-only provider dashboard/query modules (`get-provider-*.ts`) and the 4 booking-lifecycle actions a provider takes on an existing booking (`accept-booking.ts`, `reject-booking.ts`, `start-booking.ts`, `complete-booking.ts`) still use the plain `requireProvider()` check. This is documented in `requireApprovedProvider()`'s own code comment (`src/lib/auth/rbac.ts`): those flows were never named in BR-001's original scope, and a `PUBLISHED` service already requires the owning provider to have been `APPROVED` at publish time (enforced via `transition-service-status.ts`), so no unapproved provider can accrue bookings to act on in the first place. Revisit only if a concrete scenario (e.g. a provider suspended *after* publishing, with existing bookings still in flight) is raised as a real requirement — not speculatively.

### BR-002 — Provider phone numbers are never publicly visible
**Enforcement status: Enforced by omission, not by active policy code.** No phone/WhatsApp/email field is ever fetched or rendered on any customer-facing page today (verified — `ProviderProfileCard` and the service detail page). This holds today only because no feature exposes it, not because a policy layer actively blocks it. See `10-COMMUNICATION-POLICY.md`.

### BR-003 — All tourist-provider communication must pass through BARQ
**Enforcement status: Target.** No messaging feature exists yet (`Conversation`/`Message` — see `15-DATA-DICTIONARY.md`) for this rule to apply to. Binding on any future Internal Messaging Center or Support Center implementation.

### BR-004 — Category visibility supports PUBLIC, HIDDEN, LINK_ONLY, INVITE_ONLY, SCHEDULED, ARCHIVED
**Enforcement status: Enforced in code (Phase 1.1, Core Business Platform).** `Category`/`SubCategory` models exist with a `CategoryVisibilityStatus` enum holding all 6 states; `category-visibility-policy.ts`'s transition matrix (mirroring `service-status-policy.ts`) governs which transitions are valid, enforced by `transition-category-visibility.ts`/`transition-subcategory-visibility.ts`'s admin-gated Server Actions. `SCHEDULED` requires a future `scheduledVisibleAt`; a `SubCategory`'s effective visibility is always the stricter of its own status and its parent `Category`'s (resolves this rule's previously-open inheritance question — see `07-CATEGORIES.md`). See `18-DOMAIN-MODEL.md`'s Marketplace context (Bounded Context #16, `ADR-0013`).

### BR-005 — Admin defines commission policy
**Enforcement status: Partially enforced.** A `Commission` model exists and is assigned per-provider, but only 3 fixed percentage tiers (`TIER_12`/`TIER_10`/`TIER_8`) — no admin UI sets it (only seed data / direct DB access today), and no per-category/subcategory/service granularity, fixed-fee, hybrid, zero, or manual-agreement model exists. See `08-PRICING-COMMISSIONS.md`.

### BR-006 — Business configuration belongs in admin; security belongs in code
**Enforcement status: Enforced as an architectural principle, verified consistent with current code.** RBAC, authentication, and payment-state transitions are all code-controlled today (`src/lib/auth/`, `src/lib/booking/lifecycle/`); nothing security-relevant is currently admin-configurable. This is the governing principle for every future engine — see `11-SECURITY-POLICY.md` for the full boundary statement.

### BR-007 — A booking's status may only change through the centralized lifecycle engine
**Enforcement status: Enforced in code.** `src/lib/booking/lifecycle/transitions.ts` validates every transition; direct writes to `Booking.status` outside `transitionBooking()` do not occur anywhere in the current codebase (verified).

### BR-008 — A booking's price and commission are snapshotted at confirmation, never retroactively recalculated
**Enforcement status: Enforced in code.** `Booking.priceSnapshotAmount`/`commissionSnapshotAmount`/`commissionSnapshotTier` are written once, at confirmation; a later `Price`/`Commission` change never mutates an existing booking's snapshot (verified — these fields have no other writer).

### BR-009 — A stale, unanswered booking request automatically expires
**Enforcement status: Enforced in code.** `src/lib/booking/expire-stale-bookings.ts` (Phase 5.1), run every 30 minutes via Vercel Cron, transitions any `PENDING_PROVIDER` booking whose slot's `startTime` has already passed to `EXPIRED`, releasing held capacity.

### BR-010 — Availability capacity can never be oversold
**Enforcement status: Enforced in code.** `create-booking.ts` uses a single atomic conditional `UPDATE` (raw SQL) inside the same transaction as booking creation — verified to be immune to race conditions under concurrent load (PostgreSQL row-level locking).

### BR-011 — Individual and commercial providers have different onboarding requirements
**Enforcement status: Target.** No individual/commercial discriminator exists on `Provider` today — a single onboarding form applies to everyone. See `05-PROVIDER-EXPERIENCE.md`.

### BR-012 — Every provider and service must have a professional public page
**Enforcement status: Partially enforced.** A real public page exists for both today (name/description/status for providers; name/description/price/availability for services) — but lacks logo, gallery, website, Maps location, and opening hours, none of which are modeled yet. See `15-DATA-DICTIONARY.md`'s `ProviderProfile` entry.

### BR-013 — Category-specific provider requirements must be configurable, not hardcoded
**Enforcement status: Target.** Depends on both Category (BR-004) and a Form Builder existing. See `07-CATEGORIES.md`, `../plans/ROADMAP.md`.

### BR-014 — Pricing may be admin-controlled, provider-controlled, both-with-approval, or request-for-quote
**Enforcement status: Target.** Today, pricing is provider-controlled only, with no approval step and no RFQ flow. See `08-PRICING-COMMISSIONS.md`.

### BR-015 — Financial calculations must distinguish gross, discounts, taxes, commission, net, paid, outstanding, settlement, and transfer status
**Enforcement status: Partially enforced.** Gross amount, commission (fixed-tier), and payment capture/refund state exist. Discounts, taxes, an explicit net-amount field, and settlement/transfer status do not exist anywhere in the schema. See `08-PRICING-COMMISSIONS.md`, `15-DATA-DICTIONARY.md`'s `Settlement` entry.

### BR-016 — Static UI translations remain developer-curated; they are never machine-generated placeholders
**Enforcement status: Enforced as a discipline, verified consistent across every phase of this project.** Every locale file inspected across this project's history contains real, human-quality translations, not placeholder text — this has held even under significant time pressure across many phases. See `09-TRANSLATION-I18N.md`.

### BR-017 — Provider-generated business content may use an AI-assisted translation workflow with review states
**Enforcement status: Target.** No AI/LLM translation code exists anywhere in the codebase today; `LLM_GATEWAY_API_KEY` is a reserved, unused environment variable. See `09-TRANSLATION-I18N.md`.

### BR-018 — The platform's architecture must remain API-first
**Enforcement status: Partially enforced, with a known drift.** ADR-0011 mandates versioned public APIs (`/api/v1/...`); the real API surface under `src/app/api/` has zero versioning today. Existing endpoints work correctly but do not yet follow the versioning convention the ADR requires. See `13-OPEN-QUESTIONS.md`.

### BR-019 — Every admin/provider mutation not already covered by a dedicated event-history model is written to the AuditLog, atomically with the mutation itself
**Enforcement status: Enforced in code, for the 4 mutation types it currently covers.** Provider approval, service publish/unpublish/archive, and availability slot create/update/delete/bulk-create all write an `AuditLog` row inside the same transaction as the mutation (Phase 5.2). Not yet extended to every mutation in the system — see `../plans/ROADMAP.md`'s note that this extends incrementally as new engines ship.

### BR-020 — An AI agent may never autonomously touch money, approve a provider, finalize a contract, or bypass authorization
**Enforcement status: Enforced as a governance boundary (ADR-0008); moot in practice today since no AI Center exists yet.** Binding on any future AI Center implementation (planned engine #14/Phase 8) regardless of how that engine is eventually built.

### BR-021 — A rejected/cancelled/expired booking releases its held capacity back to the Availability slot
**Enforcement status: Enforced in code.** `cancel-booking.ts`, `reject-booking.ts`, and `expire-stale-bookings.ts` all perform the same atomic `bookedCount` decrement inside their respective transactions (verified, consistent pattern across all three).

### BR-022 — The official Arabic name of the platform is "برق," never "بارق"
**Enforcement status: Partially enforced — a known, uncorrected inconsistency exists.** `messages/ar/common.json`'s `appName` correctly uses "برق"; `messages/ar/landing.json` incorrectly uses "بارق" in 13 places. See `13-OPEN-QUESTIONS.md` for the tracked content-correction item.

---

## How to add a new rule

Append it with the next sequential ID (never reuse or reorder), state its Enforcement Status honestly against real, verified code (not against what a related doc merely claims), and link to the project-memory file with fuller context. If a rule is later found to conflict with another, do not silently resolve it here — add both, note the conflict, and record the resolution in `17-CHANGELOG-DECISIONS.md` once actually decided.
