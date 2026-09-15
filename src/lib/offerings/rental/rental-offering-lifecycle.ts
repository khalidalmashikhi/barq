import type { RentalOfferingStatus } from "@prisma/client";

// Phase 3C Slice C2b-R — the PURE lifecycle state machine for a RentalOffering. Isomorphic,
// no I/O. The mutations compose this with a GUARDED updateMany (transition only when the row is
// still in `from`) so concurrent transitions can never both succeed.
//
// Allowed transitions (locked):
//   DRAFT      → PUBLISHED | ARCHIVED
//   PUBLISHED  → SUSPENDED | ARCHIVED
//   SUSPENDED  → PUBLISHED | ARCHIVED
// ARCHIVED is TERMINAL — no transition out of it.

const ALLOWED: Record<RentalOfferingStatus, readonly RentalOfferingStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

/** True when `from → to` is an allowed lifecycle transition (a same-state no-op is NOT a transition). */
export function isAllowedRentalTransition(from: RentalOfferingStatus, to: RentalOfferingStatus): boolean {
  return (ALLOWED[from] as readonly string[]).includes(to);
}

/** ARCHIVED is terminal and immutable — no lifecycle or content mutation is permitted. */
export function isRentalOfferingArchived(status: RentalOfferingStatus): boolean {
  return status === "ARCHIVED";
}

/** Publishing (DRAFT→PUBLISHED or SUSPENDED→PUBLISHED) runs the full compliance/readiness checks. */
export function isRentalPublishTransition(to: RentalOfferingStatus): boolean {
  return to === "PUBLISHED";
}

/** The statuses whose CONTENT (rates, days, start-times, capacity) a provider may still edit. */
export const RENTAL_EDITABLE_STATUSES: readonly RentalOfferingStatus[] = ["DRAFT", "PUBLISHED", "SUSPENDED"];

/** A live edit of a PUBLISHED offering re-runs full compliance; DRAFT/SUSPENDED do not. */
export function rentalEditRequiresLiveCompliance(status: RentalOfferingStatus): boolean {
  return status === "PUBLISHED";
}
