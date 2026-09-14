import type { AssetVerificationStatus } from "@prisma/client";

// Phase 3C Slice B — the SINGLE, pure rule deciding whether a provider's edit to a vehicle's
// safety-sensitive capacity fields must re-open verification.
//
// Capacity (bookable customer capacity + registered seats) is safety data. Once a vehicle is
// trusted (verification APPROVED) or actively under admin review (SUBMITTED), a provider must
// not be able to silently change how many customers may board while the vehicle keeps its
// admin-verified status — that would let an UNVERIFIED claim masquerade as an admin-verified
// value. When such a change happens, the vehicle returns to DRAFT: the fail-closed,
// provider-editable, NON-selectable baseline, from which the provider must re-submit and an
// admin must re-approve. This REUSES the existing asset-verification lifecycle (no new system),
// never auto-approves, and never touches the operational Asset.status axis.
//
// Edits from an already-untrusted state (DRAFT / CHANGES_REQUESTED / REJECTED) need no reset:
// those are not trusted, and REJECTED keeps its admin reason rather than being silently cleared.
// A no-op edit (capacity unchanged) never resets — only an actual change to a capacity value.
export const CAPACITY_REVERIFICATION_TRIGGER_STATUSES = ["SUBMITTED", "APPROVED"] as const;

export type CapacityFacts = {
  bookablePassengerCapacity: number | null;
  registeredSeats: number | null;
};

export function capacityChangeRequiresReverification(params: {
  status: AssetVerificationStatus | string;
  before: CapacityFacts;
  after: CapacityFacts;
}): boolean {
  const isTrustedOrUnderReview = (CAPACITY_REVERIFICATION_TRIGGER_STATUSES as readonly string[]).includes(
    params.status,
  );
  if (!isTrustedOrUnderReview) return false;
  return (
    params.before.bookablePassengerCapacity !== params.after.bookablePassengerCapacity ||
    params.before.registeredSeats !== params.after.registeredSeats
  );
}
