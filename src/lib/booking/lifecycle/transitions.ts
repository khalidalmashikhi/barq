import "server-only";
import type { BookingStatus } from "@prisma/client";

// Booking Lifecycle Engine — Phase E.1, extended in Phase 4.1. The one
// centralized transition matrix — every status change in the codebase
// must be validated against this, never against an ad hoc if/else
// scattered at the call site ("no scattered status checks" / "every
// status change must pass through one engine").
//
// Phase 4.1 ("Complete the Booking Lifecycle") inserted a real
// provider-facing gate between creation and confirmation, per the
// approved plan's diagram: CREATED -> PENDING_PROVIDER -> CONFIRMED ->
// COMPLETED, plus REJECTED as its own terminal negative outcome
// distinct from CANCELLED (a provider *rejecting* a request is a
// different event from a customer *cancelling* one, and the product
// audit found the codebase had no way to represent the former at all).
// CREATED remains a real, momentary status — create-booking.ts
// transitions every new booking straight to PENDING_PROVIDER inside the
// same transaction that creates it (see create-booking.ts), so CREATED
// is never a resting state a booking is found in during normal
// operation.
//
// PENDING_PROVIDER -> CANCELLED is kept reachable so a customer can
// still cancel a request that's awaiting the provider — this preserves
// the exact cancellation capability that existed pre-4.1 (previously
// CREATED -> CANCELLED); nothing about the customer's cancel experience
// changes. canCancelBooking() in cancellation-policy.ts needs zero code
// changes — it already delegates to canTransition(status, "CANCELLED"),
// which now correctly includes PENDING_PROVIDER instead of CREATED.
//
// PENDING_PROVIDER -> EXPIRED, new in Phase 5.1 (Production Readiness):
// a system-driven timeout distinct from both CANCELLED (customer-
// initiated) and REJECTED (provider's explicit decision) — see
// expire-stale-bookings.ts, which fires this transition once a
// PENDING_PROVIDER booking's Availability slot's startTime has already
// passed with no provider response.

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  CREATED: ["PENDING_PROVIDER"],
  PENDING_PROVIDER: ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED", "DISPUTED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED: [],
  // New in Phase 4.1: terminal, a provider's explicit rejection of a
  // pending request. Distinct from CANCELLED (customer-initiated) so
  // the timeline and any future analytics can tell the two apart.
  REJECTED: [],
  // New in Phase 5.1: terminal, a system-driven timeout — see the note
  // above TRANSITIONS.
  EXPIRED: [],
  // Terminal, deliberately, for this phase: dispute RESOLUTION (moving
  // a DISPUTED booking back to COMPLETED or CANCELLED) is a distinct
  // future feature with its own actor-aware business rules (e.g. only
  // an Admin/Staff resolving a support ticket, not a customer's
  // ordinary cancel action) that doesn't exist yet — leaving DISPUTED
  // with no outgoing transition avoids speculatively guessing that
  // rule now. A caught regression during Phase E.1's own testing is
  // exactly why: an earlier draft allowed DISPUTED -> CANCELLED here,
  // which would have silently let a customer's ordinary cancelBooking()
  // cancel a disputed booking too, once cancellation-policy.ts's
  // canCancelBooking() started delegating to this matrix — a real
  // behavior change that phase had to avoid introducing. See
  // cancellation-policy.ts's own note on why that function keeps its
  // own narrower, explicit list instead of delegating here.
  DISPUTED: [],
};

export function getAllowedNextStatuses(from: BookingStatus): readonly BookingStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
