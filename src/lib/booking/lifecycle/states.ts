import "server-only";
import type { BookingStatus } from "@prisma/client";

// Booking Lifecycle Engine — Phase E.1 (Booking Lifecycle & Contract
// Foundation), extended in Phase 4.1 (Complete the Booking Lifecycle).
//
// Single source of truth for which BookingStatus values exist and
// which are terminal (no outgoing transition ever leaves them — see
// transitions.ts). Deliberately built on Prisma's own generated
// BookingStatus enum rather than a parallel, hand-rolled one.
// PENDING_PROVIDER and REJECTED were added in Phase 4.1 to give the
// provider a real accept/reject gate — see transitions.ts's own note.

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
  "EXPIRED",
];

// COMPLETED is intentionally NOT terminal here: a dispute may still be
// raised after completion (COMPLETED -> DISPUTED), matching DISPUTED's
// existing, pre-this-phase role as a post-hoc exceptional branch.
// CANCELLED, REJECTED, DISPUTED, and EXPIRED all have no outgoing
// transition — CANCELLED matches the existing, pre-Phase-4.1
// cancellation-policy.ts rule; REJECTED (new in Phase 4.1) is a
// provider's final word on a pending request; DISPUTED is terminal
// because dispute *resolution* is a future feature with its own
// actor-aware rules not designed here (see transitions.ts's own note);
// EXPIRED (new in Phase 5.1) is a system-driven timeout, also final.
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = ["CANCELLED", "REJECTED", "DISPUTED", "EXPIRED"];

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}
