import "server-only";

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
// cancel-booking.ts remains the sole authoritative enforcement point —
// this module only centralizes the *rule*, it does not move or weaken
// where it is actually enforced. The UI's use of canCancelBooking() is
// a display-only convenience; a client can never cancel a booking
// without cancel-booking.ts independently re-checking this same rule
// server-side, against the database, regardless of what the UI showed.

const CANCELLABLE_BOOKING_STATUSES = ["CREATED", "CONFIRMED"];

export function canCancelBooking(status: string): boolean {
  return CANCELLABLE_BOOKING_STATUSES.includes(status);
}
