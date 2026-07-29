import "server-only";
import type { BookingContractStatus } from "@prisma/client";

// Contract Lifecycle Engine — Phase E.2. Distinct, typed errors —
// mirrors src/lib/booking/lifecycle/errors.ts's design exactly.

export class BookingContractNotFoundError extends Error {
  constructor(contractId: string) {
    super(`BookingContract not found: ${contractId}`);
    this.name = "BookingContractNotFoundError";
  }
}

export class InvalidBookingContractTransitionError extends Error {
  readonly from: BookingContractStatus;
  readonly to: BookingContractStatus;

  constructor(from: BookingContractStatus, to: BookingContractStatus) {
    super(`Invalid contract transition: ${from} -> ${to}`);
    this.name = "InvalidBookingContractTransitionError";
    this.from = from;
    this.to = to;
  }
}

// Requirement #9 (Archive): a contract's content/status must never be
// mutated once it has been superseded by a newer revision — this is
// the guard that enforces it, distinct from an ordinary invalid
// transition (the target status might otherwise be perfectly valid).
export class ArchivedBookingContractError extends Error {
  constructor(contractId: string) {
    super(`BookingContract is archived and immutable: ${contractId}`);
    this.name = "ArchivedBookingContractError";
  }
}
