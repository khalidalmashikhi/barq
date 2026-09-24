import "server-only";
import {
  RENTAL_VEHICLE_SELECT,
  assertRentalVehicleReady,
  type LoadedRentalVehicle,
} from "../rental-offering-authorization";
import type { RentalOfferingErrorCode } from "../rental-offering-errors";
import { isRentalReadinessBlocker, type RentalReadinessBlockerCode } from "./rental-offering-status";

// Phase 3C Slice C2d-R1 — shared, fail-closed readiness computation for the provider rental
// workspace read models. Vertical compliance is a PROVIDER-GLOBAL fact (evaluate once with
// assertRentalVerticalCompliant and pass the result in); vehicle readiness is CANDIDATE-LOCAL and
// pure over the loaded snapshot (assertRentalVehicleReady) — mirroring the C2b-R2 publishability
// split so a list of N offerings costs one vertical read, not N. It surfaces only a single
// most-relevant, provider-actionable blocker code; it never exposes document ids or raw evidence.

/** The vehicle projection the workspace list/detail need: readiness inputs + display fields. */
export const RENTAL_WORKSPACE_VEHICLE_SELECT = {
  ...RENTAL_VEHICLE_SELECT,
  make: true,
  model: true,
  modelYear: true,
  color: true,
  vehicleType: true,
  registeredSeats: true,
} as const;

export type LoadedWorkspaceVehicle = LoadedRentalVehicle & {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  registeredSeats: number | null;
};

/**
 * Resolve the single most-relevant readiness blocker for an offering: the provider-global vertical
 * blocker (evaluated once by the caller) takes precedence, else the candidate-local vehicle blocker.
 * Returns null when the offering is fully ready. Both underlying authorities only ever yield codes
 * that are readiness blockers, but we narrow through `isRentalReadinessBlocker` for type-safety.
 */
export function resolveRentalReadinessBlocker(
  verticalBlocker: RentalOfferingErrorCode | null,
  vehicle: LoadedRentalVehicle,
  now: Date,
): RentalReadinessBlockerCode | null {
  if (verticalBlocker !== null && isRentalReadinessBlocker(verticalBlocker)) return verticalBlocker;
  const vehicleBlocker = assertRentalVehicleReady(vehicle, now);
  if (vehicleBlocker !== null && isRentalReadinessBlocker(vehicleBlocker)) return vehicleBlocker;
  return null;
}
