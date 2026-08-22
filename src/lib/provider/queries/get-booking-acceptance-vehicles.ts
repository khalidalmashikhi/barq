import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { loadOwnedTourServiceContext } from "@/lib/tour-template/vehicle-pool/tour-service-context";
import { TOUR_PACKAGE_SEMANTICS } from "@/lib/tour-template/packages";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "@/lib/tour-template/vehicle-pool/pool-dto";
import type { VehicleAssignmentBlocker } from "@/lib/tour-template/vehicle-pool/vehicle-assignment";

// BOOKING-VEHICLE-1 — the provider-private candidate reader for a booking's acceptance
// screen: the service pool's vehicles, each with LIVE eligibility evaluated against THIS
// booking's actual party (Booking.seats) — not the service's advertised maxGuests.
//
// Returns null (no vehicle selector) for a booking that isn't the caller's, isn't awaiting
// the provider, or whose service takes no vehicle (non-tour / GUIDE_ONLY). Ownership is
// server-derived and enforced by scoping every query to the caller's own provider.id +
// booking id. Bounded reads: booking, service context, pool — never one query per vehicle.
//
// The candidate projection is a strict allowlist of customer/owner-safe fields; it NEVER
// carries registrationNumber, the base Asset status, documents, or the raw trusted flag.

export type AcceptanceVehicleCandidate = {
  vehicleId: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  /** GUEST passenger capacity (excludes driver + operating guide). */
  passengerCapacity: number | null;
  /** TRUSTED, admin-confirmed 4x4 capability (derived; never the provider claim/type). */
  isFourByFour: boolean;
  /** LIVE eligibility for THIS booking (pool + selectability + package + seats capacity). */
  eligible: boolean;
  blockers: VehicleAssignmentBlocker[];
};

export type BookingAcceptanceVehicleOptions = {
  /** True for GUIDE_WITH_TRANSPORT / GUIDE_WITH_4X4 — acceptance needs a vehicle. */
  vehicleRequired: boolean;
  /** True for GUIDE_WITH_4X4 — only trusted-4x4 vehicles are eligible. */
  requiresFourByFour: boolean;
  /** The booking's guest party the vehicle must carry. */
  seats: number;
  /** The configured pool vehicles, each with live eligibility (an ineligible one stays listed). */
  candidates: AcceptanceVehicleCandidate[];
};

export async function getBookingAcceptanceVehicleOptions(
  bookingId: string,
): Promise<BookingAcceptanceVehicleOptions | null> {
  if (!isValidUuid(bookingId)) return null;

  const { provider } = await requireProvider();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, providerId: provider.id },
    select: { id: true, serviceId: true, seats: true, status: true },
  });
  // Missing / not-owned / not awaiting the provider → no selector (uniform null).
  if (!booking || booking.status !== "PENDING_PROVIDER") return null;

  const contextResult = await loadOwnedTourServiceContext(prisma, provider.id, booking.serviceId);
  if (!contextResult.ok) return null; // non-tour → no vehicle concept

  const { packageType } = contextResult.context;
  const semantics = TOUR_PACKAGE_SEMANTICS[packageType];
  const vehicleAllowed = semantics.includesTransport || semantics.vehicleOptional;
  if (!vehicleAllowed) return null; // GUIDE_ONLY → no selector

  const rows = await prisma.tourServiceVehicle.findMany({
    where: { serviceId: booking.serviceId },
    orderBy: [{ createdAt: "asc" }, { vehicleId: "asc" }],
    select: { vehicle: { select: POOL_VEHICLE_SELECT } },
  });

  const now = new Date();
  const candidates: AcceptanceVehicleCandidate[] = rows.map((r) => {
    const evaluated = evaluatePoolVehicle(
      r.vehicle as unknown as PoolVehicleRow,
      { serviceId: booking.serviceId, providerId: provider.id, packageType, maxGuests: booking.seats },
      now,
    );
    const v = evaluated.vehicle;
    // Allowlist — never the private registrationNumber / status the ProviderVehicleDTO also carries.
    return {
      vehicleId: v.id,
      make: v.make,
      model: v.model,
      modelYear: v.modelYear,
      color: v.color,
      vehicleType: v.vehicleType,
      passengerCapacity: v.passengerCapacity,
      isFourByFour: v.isFourByFour,
      eligible: evaluated.eligible,
      blockers: evaluated.blockers,
    };
  });

  return {
    vehicleRequired: semantics.includesTransport,
    requiresFourByFour: semantics.requiresFourByFour,
    seats: booking.seats,
    candidates,
  };
}
