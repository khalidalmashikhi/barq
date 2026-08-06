# 19 — Event Catalog (Enterprise Governance Layer)

`docs/02-domain-architecture/DOMAIN_MODEL.md` §3 already lists business-level occurrences ("Domain Events") and explicitly states: *"no technical/system events (those belong to `EVENTS.md`, not yet written, which will formalize these as the platform's actual event catalog)."* **This document is that long-referenced catalog** — a project-memory-level first draft of it, not yet the formal `EVENTS.md` that document anticipated (creating that would be a Locked-doc change via the ADR/RFC process, out of scope for a documentation-only phase). Do not duplicate DOMAIN_MODEL.md §3's list; this document supersedes it in detail (Trigger/Producer/Consumers/Business purpose per event) while preserving its grouping.

**Naming convention note:** DOMAIN_MODEL.md §3 uses Title Case With Spaces ("Provider Applied"). This catalog uses PascalCase concatenated names ("ProviderApplied") matching the product direction's own examples — closer to how an event would actually appear in code (an event-bus payload type, a log line). This is a presentational difference only; each entry below cross-references its DOMAIN_MODEL.md §3 equivalent where one exists. Harmonizing the two conventions in DOMAIN_MODEL.md itself is a future consideration, not done here (that document is Locked).

**Implementation status key:** **Real** (an actual code path fires this today, even if not as a formally named "event" — e.g. a status transition + a notification write); **Implicit** (the underlying state change happens, but nothing names or dispatches it as a discrete event — no event bus exists in this codebase at all, verified); **Target** (neither the state change nor any notion of the event exists yet).

---

## Identity

### UserRegistered
- **Trigger:** First successful OTP verification for a new phone number.
- **Producer:** `src/lib/auth/barq-user.ts` (`resolveBarqUser`'s branch-3 path).
- **Consumers (target):** Analytics (signup funnel), target Notification Engine (welcome message).
- **Business purpose:** Marks the moment a real person becomes a platform identity.
- **Status:** Implicit — the `User`+`Customer` row creation is real (Phase 5.1); nothing dispatches a named event from it.
- **DOMAIN_MODEL.md §3 equivalent:** "User Registered."

## Provider

### ProviderRegistered
- **Trigger:** `applyAsProvider()` successfully creates a `Provider` row.
- **Producer:** `src/lib/provider/apply-as-provider.ts`.
- **Consumers (target):** Admin approval queue (already real, via a direct query — `get-pending-providers.ts` — not event-driven), target Notification Engine.
- **Business purpose:** Starts the provider onboarding lifecycle.
- **Status:** Implicit.
- **DOMAIN_MODEL.md §3 equivalent:** "Provider Applied."

### ProviderApproved
- **Trigger:** Admin calls `approveProvider()` on a provider in `APPLIED`/`UNDER_REVIEW`.
- **Producer:** `src/lib/admin/approve-provider.ts`.
- **Consumers:** `AuditLog` (real, written atomically in the same transaction — Phase 5.2); target: Notification Engine (tell the provider), target Marketplace (provider's services become eligible to publish, pending BR-001's enforcement gap being closed).
- **Business purpose:** The one moment a provider becomes trusted/live on the platform.
- **Status:** Real (as a state change + audit write); not dispatched as a named event to any consumer beyond the audit log.
- **DOMAIN_MODEL.md §3 equivalent:** "Provider Approved."

### ProviderRejected
- **Trigger:** Target — no reject action exists today (only approve).
- **Producer (target):** A future `rejectProvider()` action.
- **Consumers (target):** Notification Engine, Audit Log.
- **Business purpose:** Closes out an application that doesn't meet requirements.
- **Status:** Target — not implemented. See `16-BUSINESS-RULES.md` BR-001's related note, `05-PROVIDER-EXPERIENCE.md`.
- **DOMAIN_MODEL.md §3 equivalent:** None ("Provider Suspended" exists there instead, a different lifecycle point).

## Marketplace

### ServiceCreated
- **Trigger:** `createService()` succeeds.
- **Producer:** `src/lib/provider/create-service.ts`.
- **Consumers (target):** Analytics, target Category assignment.
- **Business purpose:** A new bookable offering enters the catalog (as `DRAFT`).
- **Status:** Implicit.
- **DOMAIN_MODEL.md §3 equivalent:** None named explicitly (Service lifecycle wasn't broken into events in the original catalog).

### ServiceCategorized
- **Trigger:** a `categoryId` is set or changed on a Service via create/update (provider or admin).
- **Producer:** `src/lib/{provider,admin}/{create,update}-service.ts`.
- **Consumers:** `AuditLog` (real — actions `service.category_assigned` / `service.category_changed`, previous/new `categoryId` only, no localized content); target: Marketplace search-index refresh, Analytics.
- **Business purpose:** A service is filed under a taxonomy node, making it discoverable (Task B write path, 2026-08-06).
- **Status:** Real (state change + in-transaction audit write). Emitted as a named audit action, **not** a dispatched domain event — per the deferred domain-events decision, event-shaped names are kept so a future per-domain lifecycle hook can adopt them 1:1.

### ServicePublished
- **Trigger:** `publishService()` succeeds (requires BOTH a `categoryId` — BR-026 — AND an `ACTIVE` `Price`; gated by the shared `assertServicePublishable`, which returns all blockers in order).
- **Producer:** `src/lib/provider/transition-service-status.ts`, `src/lib/admin/transition-service-status.ts`.
- **Consumers:** `AuditLog` (real, Phase 5.2); target: Marketplace search-index refresh, Analytics.
- **Business purpose:** A service becomes bookable by customers.
- **Status:** Real (state change + audit write).

### ServiceHidden
- **Trigger:** `unpublishService()` succeeds (service moves to `PAUSED`).
- **Producer:** `src/lib/provider/transition-service-status.ts`.
- **Consumers:** `AuditLog` (real).
- **Business purpose:** A provider temporarily removes a service from customer visibility without losing its data (distinct from `ARCHIVED`, which is one-way).
- **Status:** Real.

## Booking

### BookingCreated
- **Trigger:** `createBooking()` succeeds.
- **Producer:** `src/lib/booking/create-booking.ts`.
- **Consumers:** `BookingStatusEvent` (real), `onPendingProvider` notification hook (real — notifies the provider).
- **Business purpose:** A customer's reservation request enters the system.
- **Status:** Real, including a genuine hook-dispatched notification.
- **DOMAIN_MODEL.md §3 equivalent:** "Booking Created."

### BookingConfirmed
- **Trigger:** Provider calls `acceptBooking()`.
- **Producer:** `src/lib/booking/accept-booking.ts`.
- **Consumers:** `BookingStatusEvent` (real), `onAccepted` notification hook (real — notifies the customer), `Commission` lookup + Booking's commission snapshot write (real, Phase 2.11), `Payment` row creation in `INITIATED` status (real, Phase 2.12).
- **Business purpose:** The provider commits to fulfilling the booking; price/commission snapshot is taken and a Payment record begins existing for it.
- **Status:** Real.
- **DOMAIN_MODEL.md §3 equivalent:** "Booking Confirmed."

### BookingCompleted
- **Trigger:** Provider calls `completeBooking()` (booking already `IN_PROGRESS`).
- **Producer:** `src/lib/booking/complete-booking.ts`.
- **Consumers:** `BookingStatusEvent` (real), `Invoice` row creation (real, Phase 2.13 — see the Invoicing section below).
- **Business purpose:** Marks the service as actually delivered; this is the point an Invoice is issued, not booking confirmation, since a merely-CONFIRMED booking can still be cancelled or disputed (see `BookingCancelled` above and `lifecycle/transitions.ts`) and this domain deliberately has no Credit Note workflow to correct a premature Invoice.
- **Status:** Real (as of Phase 2.13 — the Invoice side; the status transition itself was already real since Phase 4.2).
- **DOMAIN_MODEL.md §3 equivalent:** None named explicitly in the original catalog (only Created/Confirmed/Cancelled/Disputed were listed) — added here since it's now a real trigger for a downstream effect (Invoice).

### BookingCancelled
- **Trigger:** Customer calls `cancelBooking()`, or the booking expires unanswered (`expireStaleBookings()`).
- **Producer:** `src/lib/booking/cancel-booking.ts` / `src/lib/booking/expire-stale-bookings.ts`.
- **Consumers:** `BookingStatusEvent` (real), `onCancelled`/`onExpired` notification hooks (real — notify both parties), capacity release (real, atomic).
- **Business purpose:** Releases held capacity and informs both parties a booking will not proceed.
- **Status:** Real.
- **DOMAIN_MODEL.md §3 equivalent:** "Booking Cancelled."

## Payments

### PaymentInitiated
- **Trigger:** `acceptBooking()` succeeds and the Booking has a real price snapshot — i.e. `BookingConfirmed` above.
- **Producer:** `src/lib/booking/accept-booking.ts`.
- **Consumers (target):** No consumer exists yet.
- **Business purpose:** Marks that a Booking now has a real financial obligation associated with it, in `INITIATED` status — the starting point of `Payment`'s own documented lifecycle (`DOMAIN_MODEL.md`: "Initiated → Captured → (Refunded...) — or Failed").
- **Status:** Real (Phase 2.12).
- **DOMAIN_MODEL.md §3 equivalent:** "Payment Received" is the nearest named event, but is a poor match — see `PaymentRefunded` below for why "Received"/"Captured" specifically has never been implemented.

### PaymentRefunded
- **Trigger:** Target — **no real trigger exists, and none can exist yet.** Investigated in full during Phase 2.14 (Refund Foundation Inspection): `REFUNDED_PARTIAL`/`REFUNDED_FULL` (`PaymentStatus`) are only reachable, per `DOMAIN_MODEL.md`'s own documented lifecycle, from `CAPTURED` — and **zero code anywhere in this codebase ever sets a Payment to `CAPTURED`** (confirmed by exhaustive grep across `src/`; real data confirms 0 Payment rows of any status exist as of this phase). Capture requires a real Payment Gateway integration, which remains explicitly out of scope (Phase 2.12 and this phase both exclude it). A refund cannot meaningfully exist before a capture does.
- **Producer (target):** A future action gated on `Payment.status === "CAPTURED"`, built once Payment Gateway integration exists.
- **Consumers (target):** `WalletTransaction` (cause `REFUND_ADJUSTMENT` — schema-defined, never written), Notification Engine, Support Ticket resolution (`DOMAIN_MODEL.md`'s own invariant: "A Support Ticket involving a refund claim cannot be Resolved without a corresponding Payment/Wallet Transaction outcome recorded" — `SupportTicket` itself remains 100% schema-only, zero implementation, confirmed unchanged this phase).
- **Business purpose:** Would return captured funds to a Customer, fully or partially, and record the financial consequence.
- **Status:** Target — genuinely not implementable without inventing a capture step first, which this phase does not have authorization to add (Payment Gateway integration is explicitly excluded). See Phase 2.14's own report for the full reasoning.
- **Related, discovered-but-distinct gap (also not implemented this phase):** `cancelBooking()`/`rejectBooking()`/`expireStaleBookings()` never touch an existing `Payment` row — a Booking cancelled after confirmation leaves its `INITIATED` Payment permanently dangling, with no `FAILED` closure. This is not a refund (nothing was ever captured to give back), so it does not belong under this event; it is a `Payment` lifecycle-completion item for a future, separately-scoped phase.
- **DOMAIN_MODEL.md §3 equivalent:** "Refund Issued" (Payments).

## Invoicing

### InvoiceGenerated
- **Trigger:** `completeBooking()` succeeds and the Booking has a real price snapshot — i.e. `BookingCompleted` above, not `BookingConfirmed`.
- **Producer:** `src/lib/booking/complete-booking.ts`, via `src/lib/invoicing/generate-invoice-number.ts` and `src/lib/invoicing/build-invoice-content.ts`.
- **Consumers (target):** No consumer exists yet — no Notification/Email is sent, per this phase's explicit scope (no Email/SMS invoices).
- **Business purpose:** Produces the platform's immutable financial/legal record of a completed transaction — `invoiceNumber` (Postgres-sequence-backed, format `BARQ-YYYY-NNNNNN`, mirroring `BookingContract`'s own number generator exactly), bilingual `content`, and — when one exists — a link to the real `Payment` row created at `BookingConfirmed`.
- **Status:** Real (Phase 2.13). Discovery note: `DATABASE_DESIGN.md` §4's context table lists Invoicing's trigger as *"Booking Confirmed/Completed, Payment Received"* — ambiguous between Confirmed and Completed, and further complicated by "Payment Received" (≈ captured) never actually firing in this system (no Payment Gateway exists). The one real precedent already in the codebase, `prisma/seed.ts`, resolves this ambiguity in practice: it only ever creates an Invoice for a `COMPLETED` booking, decoupled from Payment's capture state entirely. This implementation follows that real precedent, extended to also set the real `paymentId` link seed.ts itself said was "out of scope" only because no real Payment model existed yet at the time it was written.
- **DOMAIN_MODEL.md §3 equivalent:** "Invoice Generated" (Invoicing).

## Finance

### SettlementGenerated
- **Trigger:** Target — no settlement concept exists today.
- **Producer (target):** A future Financial Engine settlement job.
- **Consumers (target):** Provider (payout notification), Finance Staff (reconciliation).
- **Business purpose:** Marks that a provider's earnings for a period have been calculated and are ready for transfer.
- **Status:** Target — not implemented. See `15-DATA-DICTIONARY.md`'s `Settlement` entity, `08-PRICING-COMMISSIONS.md`.
- **DOMAIN_MODEL.md §3 equivalent:** None ("Payout Processed" exists under Wallet — a related but distinct later step).

## Communication

### SupportTicketOpened
- **Trigger:** Target — `SupportTicket` creation has no code path today.
- **Producer (target):** A future Support Center feature.
- **Consumers (target):** Support Staff queue, Audit Log.
- **Business purpose:** Starts the "ساعدني" assistance workflow.
- **Status:** Target — model exists, zero implementation. See `15-DATA-DICTIONARY.md`.

### SupportTicketClosed
- **Trigger:** Target.
- **Producer (target):** Support Staff resolving/closing a ticket.
- **Consumers (target):** Customer/Provider notification, Analytics.
- **Business purpose:** Marks resolution.
- **Status:** Target.

### NotificationSent
- **Trigger:** Any `notifyBookingEvent()`-style call succeeds (real, today scoped to booking lifecycle notifications).
- **Producer:** `src/lib/booking/lifecycle/notify.ts` (and the equivalent contract-execution notify module).
- **Consumers:** `Notification` row (real), Notification Center UI (real, read/mark-read).
- **Business purpose:** Informs a user of something relevant that happened.
- **Status:** Real, for booking/contract-lifecycle notifications specifically — not yet a general-purpose Notification Engine with admin-configurable triggers.
- **DOMAIN_MODEL.md §3 equivalent:** "Notification Sent."

## Reviews

### ReviewCreated
- **Trigger:** Customer submits a review after a completed booking.
- **Producer:** Real, Phase 4.1 (wired into Experience Detail pages).
- **Consumers:** Service/Provider public page (real — reviews render there).
- **Business purpose:** Builds public trust signal for a service/provider.
- **Status:** Real.
- **DOMAIN_MODEL.md §3 equivalent:** "Review Submitted."

## Translation

### TranslationCompleted
- **Trigger:** Target — no AI-assisted translation workflow exists.
- **Producer (target):** A future Translation Engine's AI-assisted step.
- **Consumers (target):** Content review queue (admin or provider), the entity whose bilingual field gets updated.
- **Business purpose:** Marks that a proposed translation is ready for human review.
- **Status:** Target — not implemented. See `09-TRANSLATION-I18N.md`.

## Content

### HomepageUpdated
- **Trigger:** Target — no CMS exists.
- **Producer (target):** A future CMS admin action changing homepage section content/order.
- **Consumers (target):** The homepage itself (cache invalidation), Analytics.
- **Business purpose:** Reflects an admin's content change live.
- **Status:** Target — not implemented. See `15-DATA-DICTIONARY.md`'s `HomepageSection` entity.

### CampaignActivated
- **Trigger:** Target — no `Campaign` entity exists (flagged as entirely unscoped in `13-OPEN-QUESTIONS.md`).
- **Producer (target):** Unscoped.
- **Consumers (target):** Unscoped.
- **Business purpose:** Unscoped — needs product definition before this event can be meaningfully specified.
- **Status:** Target, unscoped.

## Administration

### FeatureEnabled / FeatureDisabled
- **Trigger:** Target — no Feature Flags system exists.
- **Producer (target):** A future admin Feature Flags UI.
- **Consumers (target):** Whatever code path checks the flag; Audit Log.
- **Business purpose:** Toggles a capability without a deploy.
- **Status:** Target — not implemented. See `15-DATA-DICTIONARY.md`'s `FeatureFlag` entity.
- Every flag change should write an `AuditLog` entry per BR-019's "extends incrementally alongside every new engine" principle.

### DocumentExpired
- **Trigger:** Target — no `Document` entity exists (commercial registration, municipal licence, etc.).
- **Producer (target):** A scheduled job checking document expiry dates, mirroring `expire-stale-bookings.ts`'s existing cron pattern.
- **Consumers (target):** Provider (renewal reminder), Admin (compliance review).
- **Business purpose:** Flags a commercial provider's compliance document that needs renewal.
- **Status:** Target — not implemented. See `15-DATA-DICTIONARY.md`'s `Document` entity, `05-PROVIDER-EXPERIENCE.md`.

## AI

### AIRecommendationGenerated / AIActionEscalatedForHumanReview
**Status:** Target — `AIAgent` model exists (schema-only), zero application code. Governed by ADR-0008/BR-020 regardless of when implemented.
**DOMAIN_MODEL.md §3 equivalent:** "AI Recommendation Generated," "AI Action Escalated for Human Review" (already named there — this catalog inherits them, does not redefine them).

---

## What this catalog does not yet do

There is no event bus, message queue, or pub/sub mechanism anywhere in this codebase (verified — grep for such patterns returns nothing beyond ordinary function calls and Prisma transactions). Every "Real" status above means a state change plus, in some cases, a directly-called notification/audit function — not a dispatched, subscribable event. Building an actual event-driven architecture (if ever justified) is a Workflow Engine/architecture-level decision, not something this documentation phase authorizes or implies.
