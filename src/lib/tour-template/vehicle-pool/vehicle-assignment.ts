import type { AssetStatus, AssetVerificationStatus } from "@prisma/client";
import {
  getVehicleSelectabilityBlockers,
  type SelectabilityDocumentSnapshot,
} from "@/lib/vehicles/selectability";
import { isVehicleFourByFourCapable } from "@/lib/vehicles/capability";
import { TOUR_PACKAGE_SEMANTICS, type TourPackageKey } from "../packages";

// TOUR-VEHICLE-1 — the SINGLE authoritative decision of whether a real, provider-owned
// Vehicle may be assigned to (pooled on) a TOUR service, for a given package. Pure / no
// I/O: the server resolves the vehicle+asset state, its documents, the trusted 4x4 flag,
// its guest capacity, and the service's package + declared maxGuests, then passes them
// here. That makes the whole policy trivially unit-testable and guarantees provider UI,
// the pool readers, and the write operations all share ONE source of truth.
//
// It COMPOSES the existing authorities rather than re-deriving them:
//   • getVehicleSelectabilityBlockers — operational ACTIVE + verification APPROVED +
//     every REQUIRED document present, APPROVED, and unexpired (the same fail-closed
//     readiness the customer-selectability axis uses).
//   • isVehicleFourByFourCapable — the TRUSTED, admin-confirmed 4x4 capability ONLY.
//     SUV is not 4x4; a FOUR_BY_FOUR vehicleType code is provider-declared classification,
//     not verified drivetrain; a provider CLAIM alone never qualifies; null → not capable.
//   • TOUR_PACKAGE_SEMANTICS — the app-owned, never-admin-editable package→vehicle rules.
//
// Capacity uses the LOCKED guest-passenger semantic (Vehicle.passengerCapacity already
// EXCLUDES the driver + operating guide). It is enforced ONLY when the service declares a
// maxGuests; then a vehicle whose guest capacity is unknown or below that maximum fails
// closed — a vehicle offered for a tour must be able to carry the tour's declared party.

export type VehicleAssignmentBlocker =
  // The package forbids any vehicle (GUIDE_ONLY — vehicle must be ABSENT).
  | "PACKAGE_FORBIDS_VEHICLE"
  // From selectability (operational + verification + documents):
  | "NOT_ACTIVE"
  | "VERIFICATION_NOT_APPROVED"
  | "REQUIRED_DOCUMENT_MISSING"
  | "REQUIRED_DOCUMENT_NOT_APPROVED"
  | "REQUIRED_DOCUMENT_EXPIRED"
  // The package requires a 4x4 and this vehicle is not TRUSTED-4x4-capable.
  | "NOT_FOUR_BY_FOUR_CAPABLE"
  // The service declares a max guest party this vehicle's guest capacity cannot meet
  // (or the vehicle's guest capacity is unknown — fail-closed).
  | "INSUFFICIENT_GUEST_CAPACITY";

export type VehicleAssignmentInput = {
  packageType: TourPackageKey;
  status: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  /** TRUSTED admin-confirmed 4x4 flag (null = not verified → not capable). */
  fourByFourVerified: boolean | null;
  /** Vehicle.passengerCapacity — GUEST capacity (excludes driver + operating guide). */
  guestCapacity: number | null;
  /** guidingContent.maxGuests — the service's declared maximum guest party, or null. */
  serviceMaxGuests: number | null;
  /** Required document type keys for this asset (from requiredAssetDocumentTypesFor). */
  requiredDocumentTypes: readonly string[];
  documents: readonly SelectabilityDocumentSnapshot[];
  /** Injectable clock for deterministic tests; defaults to now. */
  now?: Date;
};

export function getVehicleAssignmentBlockers(input: VehicleAssignmentInput): VehicleAssignmentBlocker[] {
  const semantics = TOUR_PACKAGE_SEMANTICS[input.packageType];

  // GUIDE_ONLY (no transport, not optional) => vehicle must be ABSENT. A vehicle can
  // never be pooled here — categorical, so short-circuit with the single blocker.
  if (!semantics.includesTransport && !semantics.vehicleOptional) {
    return ["PACKAGE_FORBIDS_VEHICLE"];
  }

  const blockers: VehicleAssignmentBlocker[] = [];

  // Operational + verification + document readiness (the customer-selectability axis).
  // Its blocker codes are a strict subset of VehicleAssignmentBlocker.
  blockers.push(
    ...getVehicleSelectabilityBlockers({
      status: input.status,
      verificationStatus: input.verificationStatus,
      requiredDocumentTypes: input.requiredDocumentTypes,
      documents: input.documents,
      now: input.now,
    }),
  );

  // Package 4x4 requirement — trusted capability ONLY (never vehicleType/make/model).
  if (semantics.requiresFourByFour && !isVehicleFourByFourCapable({ fourByFourVerified: input.fourByFourVerified })) {
    blockers.push("NOT_FOUR_BY_FOUR_CAPABLE");
  }

  // Guest-capacity sufficiency — only enforceable when the service declares a maximum.
  // Fail-closed: an unknown vehicle guest capacity cannot prove it meets that maximum.
  if (input.serviceMaxGuests !== null) {
    if (input.guestCapacity === null || input.guestCapacity < input.serviceMaxGuests) {
      blockers.push("INSUFFICIENT_GUEST_CAPACITY");
    }
  }

  return blockers;
}

/** True only when there are zero blockers (fail-closed). */
export function isVehicleAssignable(input: VehicleAssignmentInput): boolean {
  return getVehicleAssignmentBlockers(input).length === 0;
}
