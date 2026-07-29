import "server-only";
import type { BookingContractStatus } from "@prisma/client";

// Contract Lifecycle Engine — Phase E.2 (Electronic Contract
// Foundation). Mirrors src/lib/booking/lifecycle/states.ts's role
// exactly, for the same reason: one canonical list of states and which
// are terminal, so nothing else in the codebase maintains a second copy.
//
// Unlike Phase E.1's Booking lifecycle, this phase's requirement #2
// example (Draft/Generated/Issued/Active/Completed/Cancelled/Expired)
// maps onto its own dedicated BookingContractStatus enum with no
// renaming needed — this is a brand-new enum, not a pre-existing one
// with different names to reconcile.

export const BOOKING_CONTRACT_STATUSES: readonly BookingContractStatus[] = [
  "DRAFT",
  "GENERATED",
  "ISSUED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

export const TERMINAL_BOOKING_CONTRACT_STATUSES: readonly BookingContractStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];

export function isTerminalBookingContractStatus(status: BookingContractStatus): boolean {
  return TERMINAL_BOOKING_CONTRACT_STATUSES.includes(status);
}
