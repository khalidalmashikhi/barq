import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isValidUuid } from "@/lib/uuid";
import { loadOwnedTourServiceContext } from "@/lib/tour-template/vehicle-pool/tour-service-context";
import { TOUR_PACKAGE_SEMANTICS } from "@/lib/tour-template/packages";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "@/lib/tour-template/vehicle-pool/pool-dto";
import { buildBookingVehicleSnapshot, type BookingVehicleSnapshot } from "@/lib/booking/booking-vehicle-snapshot";

// BOOKING-VEHICLE-1 — the ONE authoritative resolver for "which vehicle (if any) may be
// committed to this booking at provider acceptance". Pure of side effects (reads only),
// and takes its db client as a parameter so acceptBooking can call it BOTH before the
// external payment initiation (cheap early rejection — no gateway intent for an invalid
// vehicle) AND again inside the acceptance transaction (TOCTOU re-check, closing the gap
// between the pre-check and the commit).
//
// It NEVER duplicates eligibility rules: it composes the existing single authority
// (loadOwnedTourServiceContext → package semantics; evaluatePoolVehicle →
// getVehicleAssignmentBlockers). Pool membership is scoped to THIS service, so a foreign
// vehicle and a provider-owned-but-unpooled vehicle are the SAME uniform
// VEHICLE_NOT_IN_SERVICE_POOL — a provider can never probe another provider's assets.
//
// Capacity is checked against the ACTUAL booking party (Booking.seats), NOT the service's
// advertised maxGuests: maxGuests is a publish-readiness bound; the booking's seats are
// the real guests this vehicle must carry.

type DbClient = PrismaClient | Prisma.TransactionClient;

/** The vehicle-assignment error codes this resolver can produce (a subset of BookingActionErrorCode). */
export type VehicleAssignmentError =
  | "INVALID_INPUT"
  | "VEHICLE_REQUIRED"
  | "VEHICLE_NOT_IN_SERVICE_POOL"
  | "VEHICLE_NOT_ELIGIBLE"
  | "VEHICLE_CAPACITY_INSUFFICIENT";

export type VehicleAssignmentResolution =
  // ok — `vehicleId` is the vehicle to persist on the booking (null = no vehicle: non-tour,
  // GUIDE_ONLY, or an optional package the provider accepted without a vehicle). `snapshot`
  // is the customer-safe historical snapshot (BOOKING-VEHICLE-SNAPSHOT), non-null EXACTLY
  // when vehicleId is non-null — built from the SAME authoritative row this call validated,
  // so the two are always written together and can never diverge.
  | { ok: true; vehicleId: string | null; snapshot: BookingVehicleSnapshot | null }
  | { ok: false; error: VehicleAssignmentError };

export type ResolveVehicleAssignmentParams = {
  db: DbClient;
  serviceId: string;
  providerId: string;
  /** The booking's guest party (Booking.seats) — always ≥ 1. */
  seats: number;
  /** The vehicle the provider chose, or null when none was supplied. */
  vehicleId: string | null;
};

export async function resolveVehicleAssignmentForAcceptance(
  params: ResolveVehicleAssignmentParams,
): Promise<VehicleAssignmentResolution> {
  const { db, serviceId, providerId, seats, vehicleId } = params;

  // A non-tour service (no eligible guidingContent) has no vehicle concept — the booking
  // keeps vehicleId null and any supplied id is ignored, so acceptance is unchanged.
  const contextResult = await loadOwnedTourServiceContext(db, providerId, serviceId);
  if (!contextResult.ok) return { ok: true, vehicleId: null, snapshot: null };

  const { packageType } = contextResult.context;
  const semantics = TOUR_PACKAGE_SEMANTICS[packageType];
  const vehicleAllowed = semantics.includesTransport || semantics.vehicleOptional;
  const vehicleRequired = semantics.includesTransport;

  // GUIDE_ONLY (vehicle forbidden) — vehicleId stays null; a supplied id is ignored.
  if (!vehicleAllowed) return { ok: true, vehicleId: null, snapshot: null };

  const normalized = vehicleId && vehicleId.length > 0 ? vehicleId : null;
  if (normalized !== null && !isValidUuid(normalized)) return { ok: false, error: "INVALID_INPUT" };

  if (normalized === null) {
    // Required (GUIDE_WITH_TRANSPORT / GUIDE_WITH_4X4) → must supply one.
    // Optional (PRIVATE_CUSTOM_TOUR) → accepting with no vehicle is legitimate.
    return vehicleRequired ? { ok: false, error: "VEHICLE_REQUIRED" } : { ok: true, vehicleId: null, snapshot: null };
  }

  // Pool membership scoped to THIS service: covers foreign AND own-but-unpooled uniformly
  // (findFirst on the composite key, so no reliance on the generated compound selector name).
  const row = await db.tourServiceVehicle.findFirst({
    where: { serviceId, vehicleId: normalized },
    select: { vehicle: { select: POOL_VEHICLE_SELECT } },
  });
  if (!row) return { ok: false, error: "VEHICLE_NOT_IN_SERVICE_POOL" };

  // Defence in depth — pool membership already implies same-provider ownership (the add op
  // enforces it), but never leak a foreign vehicle's existence if data ever drifted.
  if (row.vehicle.asset.providerId !== providerId) return { ok: false, error: "VEHICLE_NOT_IN_SERVICE_POOL" };

  // LIVE eligibility via the single authority, capacity checked against the booking's seats.
  const evaluated = evaluatePoolVehicle(row.vehicle as unknown as PoolVehicleRow, {
    serviceId,
    providerId,
    packageType,
    maxGuests: seats,
  });
  if (evaluated.eligible) {
    // BOOKING-VEHICLE-SNAPSHOT — derive the customer-safe historical snapshot from the SAME
    // authoritative row that just passed eligibility (never client-supplied, never stale).
    return { ok: true, vehicleId: normalized, snapshot: buildBookingVehicleSnapshot(row.vehicle) };
  }

  // Surface the capacity boundary distinctly ONLY when it is the sole problem; any other
  // (or additional) blocker is the generic not-eligible outcome.
  const onlyCapacity =
    evaluated.blockers.length > 0 && evaluated.blockers.every((b) => b === "INSUFFICIENT_GUEST_CAPACITY");
  return { ok: false, error: onlyCapacity ? "VEHICLE_CAPACITY_INSUFFICIENT" : "VEHICLE_NOT_ELIGIBLE" };
}
