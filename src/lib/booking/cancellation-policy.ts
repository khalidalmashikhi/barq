import "server-only";
import type { BookingStatus } from "@prisma/client";
import { canTransition } from "@/lib/booking/lifecycle";

// Booking cancellation policy — Engineering Sprint (Stabilization:
// deduplicate cancellation eligibility rule).
//
// Single source of truth for "which Booking statuses are cancellable" —
// previously defined independently in cancel-booking.ts (the real
// enforcement) and bookings/[id]/page.tsx (the UI's cancel-button
// visibility check), a direct duplication of the same rule per
// PROJECT_RULES.md §22 ("no Bounded Context silently duplicates...
// logic"). The rule itself is unchanged: only CREATED and CONFIRMED
// remain cancellable, identical to both prior independent definitions.
//
// Phase E.1 (Booking Lifecycle Engine): this function now delegates to
// the lifecycle engine's own transition matrix
// (src/lib/booking/lifecycle/transitions.ts) instead of maintaining a
// second, separately-hardcoded status list. This only works because
// CANCELLED is, today, reachable from exactly CREATED and CONFIRMED in
// that matrix — an earlier draft of the matrix also allowed
// DISPUTED -> CANCELLED (for a future dispute-resolution feature) and
// this function's own test caught the resulting regression: a
// customer's ordinary cancelBooking() would have silently gained the
// ability to cancel a disputed booking too. DISPUTED was made terminal
// instead (see transitions.ts) specifically to keep this delegation
// safe. If a future phase gives DISPUTED an outgoing transition to
// CANCELLED again (for admin-driven dispute resolution, a different
// actor and business rule than a customer's self-service cancellation),
// this function must go back to its own explicit, narrower list rather
// than reuse the general matrix — re-run this file's test after any
// such change to confirm the eligibility set is still exactly what a
// customer-facing cancellation should allow.
//
// cancel-booking.ts remains the sole authoritative enforcement point —
// this module only centralizes the *rule*, it does not move or weaken
// where it is actually enforced. The UI's use of canCancelBooking() is
// a display-only convenience; a client can never cancel a booking
// without cancel-booking.ts independently re-checking this same rule
// server-side (now via the lifecycle engine itself), regardless of
// what the UI showed.

export function canCancelBooking(status: string): boolean {
  return canTransition(status as BookingStatus, "CANCELLED");
}

// Phase 4.1 ("Complete the Booking Lifecycle"): the provider's
// accept/reject gate, expressed the same way as canCancelBooking()
// above — delegating to the one centralized transition matrix rather
// than a separately-maintained status list. Both are only true from
// PENDING_PROVIDER today (see transitions.ts), enforced here once
// rather than duplicated at each of accept-booking.ts/reject-booking.ts.

export function canAcceptBooking(status: string): boolean {
  return canTransition(status as BookingStatus, "CONFIRMED");
}

export function canRejectBooking(status: string): boolean {
  return canTransition(status as BookingStatus, "REJECTED");
}

// Phase 4.2 ("Provider Experience," Priority 3 — Booking Operations):
// the provider's Start/Complete actions, same delegation pattern.
// Start is only true from CONFIRMED, Complete only from IN_PROGRESS
// (see transitions.ts) — the exact CONFIRMED -> IN_PROGRESS ->
// COMPLETED path the lifecycle engine has supported since Phase E.1,
// just never wired to a real provider action until now.

export function canStartBooking(status: string): boolean {
  return canTransition(status as BookingStatus, "IN_PROGRESS");
}

export function canCompleteBooking(status: string): boolean {
  return canTransition(status as BookingStatus, "COMPLETED");
}

// Marketplace Completion (Review Creation Flow): a review may only be
// left once a booking has reached its genuine terminal COMPLETED
// outcome — not via canTransition() like the functions above, since
// "reviewable" isn't itself a Booking status this project transitions
// into; it's a plain predicate over the status the booking already
// reached. Kept here anyway, alongside the transition-based checks,
// since this file has already become the single home for "is this
// booking-related action currently allowed" rules (its filename
// predates that broader scope) — a second file for one predicate would
// split the same kind of rule across two places for no benefit.
export function canReviewBooking(status: string): boolean {
  return status === "COMPLETED";
}
