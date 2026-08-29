// PRICING UNIT DATA INTEGRITY — the ONE strict parser for a booking's requested quantity
// (Booking.seats), shared by the single createBooking seam (so web and API v1 have identical
// semantics). PURE.
//
// Distinguishes MISSING from INVALID, and FAILS CLOSED on any explicitly-supplied invalid
// value instead of silently coercing it to 1 (the prior parseInt() coerced "0", "-1", "1.5",
// "abc" all to 1):
//   - truly ABSENT (no `seats` key at all)  → default 1 (the existing product contract:
//     slotless services never submit seats, and Booking.seats defaults to 1).
//   - a present value that is a strict positive integer → that value.
//   - anything else present (empty, 0, negative, fractional, non-numeric, unsafe-large) →
//     INVALID (the caller returns INVALID_INPUT).
//
// Service-specific bounds (minBookingSeats/maxBookingSeats) are NOT this parser's concern —
// they remain authoritative downstream in createBooking.

export type BookingQuantityResult = { ok: true; value: number } | { ok: false };

export function parseBookingQuantity(raw: FormDataEntryValue | null): BookingQuantityResult {
  // Truly absent → the deliberate default of 1.
  if (raw === null) return { ok: true, value: 1 };
  // A File (or any non-string) is never a valid quantity.
  if (typeof raw !== "string") return { ok: false };

  const trimmed = raw.trim();
  // Only unsigned integer digits: rejects "" , " ", "-1", "+1", "1.5", "1e3", "abc", "0x1".
  if (!/^\d+$/.test(trimmed)) return { ok: false };

  const value = Number(trimmed);
  // Reject 0 and anything beyond the safe-integer range (e.g. a huge digit string).
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false };

  return { ok: true, value };
}
