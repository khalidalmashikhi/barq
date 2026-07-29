import "server-only";
import type { BookingStatus } from "@prisma/client";

// Booking Lifecycle Engine — Phase E.1. Distinct, typed errors so
// callers (and tests) can distinguish "no such booking" from "that
// transition isn't allowed" without string-matching an error message.

export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "BookingNotFoundError";
  }
}

export class InvalidBookingTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Invalid booking transition: ${from} -> ${to}`);
    this.name = "InvalidBookingTransitionError";
    this.from = from;
    this.to = to;
  }
}

// Production Blocker fix — a second, distinct error from
// InvalidBookingTransitionError: that one means "the status we read is
// not a valid starting point for this transition." This one means "the
// status we read WAS valid, but something else changed it before our
// own guarded write landed" — a genuine concurrent-modification race,
// not a logic error. Callers should treat this the same way they'd
// treat any other transaction-abort: the whole $transaction rolls
// back, so no partial capacity-release/status-write pair is ever left
// half-applied.
export class ConcurrentBookingModificationError extends Error {
  readonly bookingId: string;

  constructor(bookingId: string) {
    super(`Booking ${bookingId} was modified concurrently — retry the operation.`);
    this.name = "ConcurrentBookingModificationError";
    this.bookingId = bookingId;
  }
}
