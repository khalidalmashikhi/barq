# BARQ Booking Lifecycle Engine

- **Purpose:** Documents the centralized Booking Lifecycle Engine built in Phase E.1 and extended in Phase 4.1 — the formal state machine, transition validation, timeline/history/activity log, notification wiring, and hook-based extension points that future Business Features (starting with electronic contracts) attach to, without redesigning this engine.
- **Scope:** Booking status states and transitions (including the Phase 4.1 provider gate), the single engine every status change passes through, the Booking Timeline/History API/Activity Log, lifecycle hooks and their notification wiring, the provider Accept/Reject actions, and the future contract-generation extension point.
- **Out of Scope:** Electronic contract generation itself (explicitly not built — see §6), dispute-resolution business rules (`DISPUTED` is deliberately terminal — see §2).
- **Owner:** Whoever builds the next Business Feature that touches booking status (contracts, disputes) — keep current as the engine grows.
- **Status:** Added Phase E.1 (Booking Lifecycle & Contract Foundation). Extended Phase 4.1 (Complete the Booking Lifecycle): added `PENDING_PROVIDER`/`REJECTED`, real provider Accept/Reject actions, and real notification wiring on four lifecycle hooks (previously all empty stubs).

---

## 1. Why No New State Names Were Introduced (Phase E.1), and What Phase 4.1 Changed

Phase E.1's own request illustrated the target lifecycle with example state names: Draft → Pending Provider → Accepted → Rejected → Cancelled → In Progress → Completed → Closed. At that point BARQ's actual `BookingStatus` Prisma enum had a smaller set: `CREATED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `DISPUTED` — Pending Provider and Rejected were folded into `CREATED` and `CANCELLED` respectively, to avoid a schema-breaking change not required at the time.

**Phase 4.1 ("Complete the Booking Lifecycle") revisited that decision.** The Product Audit that authorized Phase 4.1 found the collapsed model was a real product gap, not just a naming simplification: there was no way for a provider to actually act on a request (accept or reject it), and no way to tell "a customer cancelled" apart from "a provider declined" anywhere in the data. Phase 4.1 added two real enum values:

| Value | Meaning |
|---|---|
| `PENDING_PROVIDER` | A real request now sits here, awaiting the provider's Accept/Reject action. This is the status the Provider Bookings page's "Needs action" queue watches. |
| `REJECTED` | A provider's explicit decline of a pending request — terminal, and distinct from `CANCELLED` (customer-initiated). |

`CREATED` was **kept** rather than removed or repurposed: it remains the real, momentary status a `Booking` row has for the instant between its own creation and its immediate, same-transaction advance to `PENDING_PROVIDER` (see `create-booking.ts` in §3). This was the design call that touched the fewest existing functions: `recordBookingCreated()`'s `null → CREATED` write is untouched, and the schema's `status @default(CREATED)` is untouched.

**Existing data**: the migration that added the two enum values was immediately followed by a second migration doing `UPDATE bookings SET status = 'PENDING_PROVIDER' WHERE status = 'CREATED'` — a one-time data correction, not a real event, so no `BookingStatusEvent` row was fabricated for it (Postgres also requires new enum values to be committed in a separate migration/transaction before they can be used in an `UPDATE`, which is why this is two migrations, not one).

`DISPUTED` still has no equivalent in the Phase E.1 example list; it pre-dates both phases and remains a rare, exceptional branch (see §2). No `CLOSED` state was added (see §7).

## 2. States and Transition Matrix

```
CREATED ──► PENDING_PROVIDER ──► CONFIRMED ──► IN_PROGRESS ──► COMPLETED
                  │                   │               │              │
                  ├──► REJECTED       │               │              │
                  └──► CANCELLED ◄────┘               │              │
                                                        └──► DISPUTED ◄┘
                                      CONFIRMED ──────► DISPUTED
```

| From \ To | CREATED | PENDING_PROVIDER | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED | REJECTED | DISPUTED |
|---|---|---|---|---|---|---|---|---|
| **CREATED** | — | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PENDING_PROVIDER** | ❌ | — | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **CONFIRMED** | ❌ | ❌ | — | ✅ | ❌ | ✅ | ❌ | ✅ |
| **IN_PROGRESS** | ❌ | ❌ | ❌ | — | ✅ | ❌ | ❌ | ✅ |
| **COMPLETED** | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ | ✅ |
| **CANCELLED** | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ | ❌ |
| **REJECTED** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| **DISPUTED** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — |

Defined once, in `src/lib/booking/lifecycle/transitions.ts` — this table *is* the code, not a separate description of it.

- `CANCELLED` is reachable only from `PENDING_PROVIDER` and `CONFIRMED` (previously `CREATED` and `CONFIRMED`, before Phase 4.1 made `CREATED` a momentary pass-through status) — `cancellation-policy.ts`'s `canCancelBooking()` still just delegates to this matrix, so it required zero code changes when the matrix shifted. This preserves the exact real-world capability a customer had before Phase 4.1: cancel a request that hasn't been confirmed yet.
- `REJECTED` is reachable only from `PENDING_PROVIDER`, and has no outgoing transition — a provider's rejection is final.
- `DISPUTED` is reachable from `CONFIRMED`, `IN_PROGRESS`, and `COMPLETED` (a dispute can be raised at any point after acceptance, including after completion) but has **no outgoing transition** — it is deliberately terminal. An earlier Phase E.1 draft allowed `DISPUTED → CANCELLED` (for a future "dispute resolved against the booking" outcome); Phase E.1's own test suite caught the regression that would have caused, since `canCancelBooking()` delegates to this same matrix. Dispute resolution is a distinct future feature with its own actor-aware rules (almost certainly Admin/Staff-only, not a customer self-service action) — it isn't designed here, and `DISPUTED` stays terminal until it is.

## 3. The Engine

`src/lib/booking/lifecycle/` is the single place every Booking status change goes through:

- **`states.ts`** — the canonical `BookingStatus` list and which are terminal.
- **`transitions.ts`** — `canTransition(from, to)` / `getAllowedNextStatuses(from)`, the matrix above.
- **`errors.ts`** — `BookingNotFoundError`, `InvalidBookingTransitionError`.
- **`transition-booking.ts`** — `transitionBooking(params, tx?)`: reads the current status, validates it against the matrix, writes the new status (and `confirmedAt`, only when transitioning to `CONFIRMED` — see §3.1), and records one `BookingStatusEvent` row, all atomically. Accepts an optional external Prisma transaction client so a caller that already wraps a status change in its own transaction (like `cancel-booking.ts`'s capacity release) can include this engine's writes in that same transaction rather than nesting a second one.
- **`transitionBookingAndFireHooks(params)`** — the self-contained convenience wrapper: opens its own transaction, then fires the matching lifecycle hook only after that transaction has actually committed.
- **`hooks.ts`** — the extension points (§5).
- **`record-booking-created.ts`** — the one exception: a booking's *first* timeline entry, at creation, has no prior status to validate against, so it's a separate, simpler write rather than a special case inside `transitionBooking()`.
- **`get-booking-timeline.ts`** — reads the history back out (§4).

**No other file may write `Booking.status` or insert into `BookingStatusEvent` directly.** Mutators through this engine, as of Phase 4.1:

- `create-booking.ts` calls `recordBookingCreated()` (writes the `null → CREATED` event), then, inside that **same** transaction, calls `transitionBooking()` again to advance `CREATED → PENDING_PROVIDER`. The hook for that second transition (`onPendingProvider`, §5) fires only after the whole transaction commits.
- `cancel-booking.ts` calls `transitionBooking()` inside its existing transaction (alongside its capacity-release logic), then `dispatchLifecycleHook()` once that transaction commits. Unchanged in Phase 4.1 beyond the matrix shift noted in §2.
- `accept-booking.ts` (new, Phase 4.1) — `acceptBooking(bookingId)`: `requireProvider()`, verifies the booking belongs to that provider, checks `canAcceptBooking(status)` (`cancellation-policy.ts`), transitions `PENDING_PROVIDER → CONFIRMED` with `actorType: "PROVIDER"`. No capacity change — seats were already reserved at creation.
- `reject-booking.ts` (new, Phase 4.1) — `rejectBooking(bookingId, reason?)`: same shape as accept, transitions `PENDING_PROVIDER → REJECTED`, **plus** releases the booking's reserved capacity (identical `GREATEST(bookedCount - seats, 0)` raw-SQL update to `cancel-booking.ts`'s own) — a rejected request must free its seats, same as a cancelled one. `reason` is optional free text, stored on the `BookingStatusEvent` row.

All four keep the same external shape: `"use server"`, UUID validation, re-fetch-and-verify ownership from the database (never trust a client-supplied claim), a stable `BookingActionErrorCode` return (never raw exceptions or localized text), and `dispatchLifecycleHook()` called only after the transaction has committed.

### 3.1 `confirmedAt`

`Booking.confirmedAt` has existed since before this phase but nothing ever wrote to it (confirmed by a repo-wide search before this phase began) — every consumer already reads it as nullable. `transitionBooking()` is the first real writer, setting it when (and only when) a booking transitions to `CONFIRMED`. This fills in the column's already-intended meaning; it is not a new field or a new semantic.

## 4. Timeline, History API, and Activity Log

Requirements #5, #6, and #7 all turned out to need the same underlying data: an ordered, timestamped record of every status change. Rather than build three separate features, this phase built one new table — `BookingStatusEvent` (migration `20260720114533_add_booking_status_event`, purely additive: a new table and a new `BookingActorType` enum, zero changes to any existing column) — and exposes it three ways:

- **Timeline** — `getBookingTimeline(bookingId)` in `get-booking-timeline.ts`, an ordered list of `{ id, fromStatus, toStatus, actorType, reason, occurredAt }`. `fromStatus` is `null` only for the initial creation entry.
- **History API** — `GET /api/bookings/[id]/history` (`src/app/api/bookings/[id]/history/route.ts`) exposes the exact same data over HTTP as `{ bookingId, timeline }`. Guarded like `getBookingDetail()` already was: the owning Customer, the owning Provider, or an Admin can read it; anyone else (or a nonexistent booking) gets an identical `404` — never a `403` — so the endpoint cannot be used to enumerate booking IDs or confirm ownership.
- **Activity Log** — the same rows, read as "who (`actorType`) did what (`fromStatus` → `toStatus`) when (`occurredAt`), and why (`reason`, optional)." `actorType` is one of `CUSTOMER`, `PROVIDER`, `SYSTEM`, `ADMIN` — no raw `actorId` (an internal Customer/Provider/User UUID) is included in any of the three read paths above, since actor *role* is what these requirements ask for, not an internal identifier. `reason` is an optional short string (e.g. "customer requested cancellation") — never a sensitive payload.

`BookingStatusEvent.actorId` is stored (for a real audit trail, if ever needed at the database level) but is not a foreign key to any single table: an actor may be a `Customer`, `Provider`, `User` (Admin), or `null` (`SYSTEM`) depending on `actorType` — genuinely polymorphic, which Prisma cannot express as one relation. This is a log field, not a source of referential integrity.

## 5. Lifecycle Hooks and Notifications

`hooks.ts` defines one hook per non-creation transition target: `onPendingProvider` (`PENDING_PROVIDER`), `onAccepted` (`CONFIRMED`), `onRejected` (`REJECTED`), `onInProgress`, `onCompleted`, `onCancelled`, `onDisputed`. `dispatchLifecycleHook(ctx)` looks up and invokes the matching hook after a transition's transaction has committed, and swallows (logs, never rethrows) any hook failure — a hook calling a real external service must never make an already-durably-persisted status change look like it failed or rolled back.

**Phase 4.1 gave four of these real bodies** (previously all empty stubs), each calling the new `notify.ts` module:

| Hook | Fires on | Notifies |
|---|---|---|
| `onPendingProvider` | `PENDING_PROVIDER` | The **provider** — "you have a new booking request." |
| `onAccepted` | `CONFIRMED` | The **customer** — "your booking was accepted." |
| `onRejected` | `REJECTED` | The **customer** — "your booking was rejected." |
| `onCancelled` | `CANCELLED` | The **customer** — "your booking was cancelled." (Fires regardless of which actor cancelled it, matching the plain requirement "notify customer when booking is cancelled.") |

`onInProgress`, `onCompleted`, and `onDisputed` remain empty stubs — out of Phase 4.1's stated scope.

`notify.ts` mirrors `src/lib/contracts/execution/notify.ts`'s established shape exactly: a bilingual (`{ar, en}`) literal-string map keyed by a `BookingNotificationKind`, written via `prisma.notification.create({ ..., channel: "EMAIL", causingBookingId })` — the same `channel: "EMAIL"` convention every other notification in this codebase uses (no real email dispatch exists anywhere yet; this only writes the in-app row the existing Notification Center already renders). `resolveBookingParties(bookingId)` does the one extra join every hook needs (`Booking.customerId`/`providerId` are `Customer.id`/`Provider.id`, not `User.id` — `Notification.userId` needs the actual `User`).

Adding real behavior to the remaining stubs later is a body-only change inside the matching `onXxx` function — no signature change, no call-site change, no change to `transitionBooking()` or the transition matrix. This is what "must support future contract generation without requiring redesign" means concretely.

## 6. Future Contract Integration

**This phase does not generate contracts.** `onAccepted()` — fired when a booking transitions `CREATED → CONFIRMED` — is the exact, already-wired point where a future phase's contract-generation call goes. Nothing else needs to change for that to work: the hook already receives `{ bookingId, customerId, providerId, serviceId, fromStatus, toStatus }`, everything a contract generator needs to look up the full booking and create a record.

Note: `schema.prisma` already has a `Contract` model (`DRAFTED → SENT → SIGNED → ACTIVE → SUPERSEDED → TERMINATED`), predating this phase. It relates to `Provider` and `Customer` directly — a platform/provider-agreement concept, not tied to any specific `Booking` (no `bookingId` field). A future *per-booking* contract will need its own linkage (most likely a new `bookingId` column on `Contract`, or a new join model) — that design decision is explicitly out of this phase's scope, left for whichever future phase actually implements contract generation.

## 7. Other Deliberately Deferred Future Work

- **Provider Accept/Reject UI — built in Phase 4.1.** `accept-booking.ts`/`reject-booking.ts` (§3) and the Provider Bookings page's inline Accept/Reject forms (`src/app/[locale]/provider/bookings/page.tsx`) close the gap the Phase E.1 version of this doc flagged here. `start`/`complete` actions (`IN_PROGRESS`/`COMPLETED`) still have no UI — the engine supports both transitions; no requirement has asked for that surface yet.
- **Dispute resolution.** `DISPUTED` is terminal (§2). A future phase adding real resolution transitions must decide the correct actor/authorization rules first (see §2's regression note) rather than reuse a general "is this status reachable" check the way `cancellation-policy.ts` does for `CANCELLED`.
- **A `CLOSED` state after `COMPLETED`.** Not modeled — no current requirement forces it, and the matrix/hooks structure make adding a new terminal state later a matter of extending `transitions.ts`'s table and adding one more `onXxx` hook, not restructuring anything.
- **Provider verification workflow beyond Approve.** Phase 4.1 added the minimum admin surface (`src/app/[locale]/admin/`) to Approve a pending `Provider` — no suspend/reject/deactivate admin action exists yet; a natural follow-on, not built here.
