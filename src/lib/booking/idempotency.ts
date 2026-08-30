import { createHash } from "node:crypto";

// BOOKING-IDEMPOTENCY — the pure key/fingerprint contract shared by every booking-create
// entrypoint (Web form + POST /api/v1/me/bookings both flow through createBooking()).
//
// A client idempotency key is an OPAQUE, UNTRUSTED token. It is never authorization, never a
// source of booking facts, and never globally reusable across customers (the DB unique that
// arbitrates it is scoped to the authenticated customerId). This module only decides whether a
// supplied value is a structurally acceptable key, and derives the server-side request
// fingerprint from the validated booking SELECTORS — never from client-supplied money.

// Bounded length + a safe, non-executable charset (UUIDs, ULIDs, and random base64url-ish tokens
// all fit). Prefer high-entropy random/UUID keys; this only enforces shape, not entropy.
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 200;
const KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_KEY_LENGTH &&
    value.length <= MAX_KEY_LENGTH &&
    KEY_PATTERN.test(value)
  );
}

export type IdempotencyKeyParse =
  /// No key supplied — booking creation proceeds without idempotency (backward compatible).
  | { state: "absent" }
  /// A key was supplied but is malformed (wrong length / unsafe characters) — fail closed.
  | { state: "invalid" }
  /// A well-formed, opaque key.
  | { state: "valid"; key: string };

/**
 * Interpret a raw idempotency-key form value. Absent (null/empty) is legitimate; a present but
 * malformed value fails closed rather than being silently ignored. No trimming — a key is exactly
 * its safe-charset bytes, so surrounding whitespace is rejected as malformed, never normalized
 * into a colliding key.
 */
export function readIdempotencyKey(raw: FormDataEntryValue | null): IdempotencyKeyParse {
  if (raw === null) return { state: "absent" };
  if (typeof raw !== "string") return { state: "invalid" };
  if (raw.length === 0) return { state: "absent" };
  if (!isValidIdempotencyKey(raw)) return { state: "invalid" };
  return { state: "valid", key: raw };
}

/// The server-validated selectors that define a logical booking attempt. Deliberately EXCLUDES
/// any client-supplied amount/currency/total — those are never authoritative inputs (§9).
export type BookingRequestSelectors = {
  serviceId: string;
  priceId: string;
  availabilityId: string | null;
  /// The validated positive-integer booking quantity (Booking.seats).
  seats: number;
};

/**
 * Deterministic canonical fingerprint of a logical booking request. The SAME key reused with the
 * SAME selectors replays the original booking; the same key with DIFFERENT selectors is a conflict.
 * SHA-256 hex over a canonical, versioned, delimiter-safe string (all fields are UUIDs or an
 * integer, so no delimiter collision is possible).
 */
export function computeBookingRequestFingerprint(selectors: BookingRequestSelectors): string {
  // JSON of a fixed-order tuple — unambiguous by construction: a slotless request (availabilityId
  // null) encodes as `null`, distinct from any string id, so no sentinel can ever collide. All
  // fields are UUIDs / an integer, so there is no escaping ambiguity.
  const canonical = JSON.stringify([
    "v1",
    selectors.serviceId,
    selectors.priceId,
    selectors.availabilityId,
    selectors.seats,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
