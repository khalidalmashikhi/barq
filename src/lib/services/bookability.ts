// DISCOVERY & DETAIL TRUTHFULNESS — the ONE canonical answer to "can a customer
// actually book this right now?", shared by discovery cards and the service-detail CTA
// so the two can never disagree (a card must never say "available" while its detail
// page is a dead end).
//
// This module is PURE and framework-free (no server-only, no prisma) so the
// server-rendered detail view can import isBookable/deriveBookability without dragging
// the data layer into its bundle. The batched DB reader lives in ./bookability-facts.
//
// The states derive only from existing authorities — serviceRequiresSlot()'s rule
// (any non-CANCELLED Availability ⇒ slot-based) and getAvailableSlots()'s rule (OPEN,
// future, capacity − bookedCount > 0) — never a new competing availability rule. It is
// intentionally the same set of conditions the booking-page loader already fail-closes
// on; it surfaces that truth EARLIER (card + CTA) and never becomes the thing that
// permits a booking (createBooking + the booking-page loader remain the authorities).

export type Bookability =
  /// Slot-based, and at least one OPEN future slot has a free seat.
  | "BOOKABLE_NOW"
  /// No declared availability — booked as a provider-scheduled request, always open.
  | "SLOTLESS_BOOKABLE"
  /// Slot-based, but nothing is currently bookable (all full / past / blocked).
  | "NO_CURRENT_AVAILABILITY"
  /// Cannot be booked at all — no ACTIVE price exists to book against.
  | "UNAVAILABLE";

export type BookabilityInputs = {
  /// The service has at least one ACTIVE Price (the booking page refuses without one).
  hasActivePrice: boolean;
  /// serviceRequiresSlot(): ≥1 non-CANCELLED Availability row exists.
  requiresSlot: boolean;
  /// ≥1 OPEN, future Availability row with a free seat (getAvailableSlots semantics).
  hasBookableSlot: boolean;
};

/**
 * Pure bookability decision — mirrors the booking-page loader's own fail-closed
 * order: price first (no price is unbookable regardless of slots), then the
 * slot dimension. Total and deterministic.
 */
export function deriveBookability({ hasActivePrice, requiresSlot, hasBookableSlot }: BookabilityInputs): Bookability {
  if (!hasActivePrice) return "UNAVAILABLE";
  if (!requiresSlot) return "SLOTLESS_BOOKABLE";
  return hasBookableSlot ? "BOOKABLE_NOW" : "NO_CURRENT_AVAILABILITY";
}

/** Whether the state permits entering the booking flow (an active "Book now"). */
export function isBookable(state: Bookability): boolean {
  return state === "BOOKABLE_NOW" || state === "SLOTLESS_BOOKABLE";
}

/**
 * The `services` i18n key for a compact, customer-facing availability label. Shared by
 * every card surface so the wording is consistent. The raw state code is never shown.
 */
export function bookabilityLabelKey(
  state: Bookability
): "availabilityBookable" | "availabilityOpen" | "availabilityNone" | "availabilityUnavailable" {
  switch (state) {
    case "BOOKABLE_NOW":
      return "availabilityBookable";
    case "SLOTLESS_BOOKABLE":
      return "availabilityOpen";
    case "NO_CURRENT_AVAILABILITY":
      return "availabilityNone";
    case "UNAVAILABLE":
      return "availabilityUnavailable";
  }
}
