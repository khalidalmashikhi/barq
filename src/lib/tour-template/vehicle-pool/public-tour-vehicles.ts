import "server-only";
import { prisma } from "@/lib/db";
import { parseGuidingContent } from "../guiding-content";
import { TOUR_PACKAGE_SEMANTICS } from "../packages";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "./pool-dto";

// TOUR-VEHICLE-3 — the CUSTOMER-SAFE public read model for a tour's vehicles. It composes
// two layers WITHOUT rewriting either: the guidingContent PROMISE (transport / 4x4) and
// the relational pool of REAL vehicles — then exposes only a deliberate allowlist.
//
// HONESTY BOUNDARY: pool membership is NOT a booking assignment (Booking.vehicleId is
// unwired). So this surfaces vehicles as EXAMPLES currently configured for the tour, never
// a guaranteed/assigned vehicle. Only CURRENTLY-ELIGIBLE pooled vehicles are included (live
// eligibility via the SAME getVehicleAssignmentBlockers authority, not row presence): a
// configured-but-ineligible vehicle stays Provider-side only and never reaches a customer.
// For GUIDE_WITH_4X4, eligibility already requires trusted 4x4, so only trusted-4x4 vehicles
// can appear. A published-but-degraded tour (all pooled vehicles now ineligible) returns
// transportIncluded=true with an EMPTY vehicles list — the UI shows the promise, not stale data.
//
// Ownership is irrelevant here (the pool rows belong to this service); this is a public read.
// Bounded: one Experience query + one pool query (with each vehicle's Asset status axes +
// documents), eligibility evaluated in memory — never one query per vehicle.

export type PublicTourVehicle = {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  /** GUEST/customer passenger capacity (excludes driver + operating guide). */
  passengerCapacity: number | null;
  /** Canonical vehicle-type CODE (UI maps to a localized label). */
  vehicleType: string | null;
  /** TRUSTED, admin-confirmed 4x4 (derived; never the provider claim/type). */
  isFourByFour: boolean;
};

export type PublicTourVehicleSummary = {
  /** The package promises transport (GUIDE_WITH_TRANSPORT / GUIDE_WITH_4X4). */
  transportIncluded: boolean;
  /** The package requires a verified 4x4 (GUIDE_WITH_4X4). */
  requiresFourByFour: boolean;
  /** ONLY the currently-eligible pooled vehicles, as safe example summaries (never assigned). */
  vehicles: PublicTourVehicle[];
};

export async function getPublicTourVehicleSummary(serviceId: string): Promise<PublicTourVehicleSummary | null> {
  const experience = await prisma.experience.findUnique({
    where: { serviceId },
    select: { guidingContent: true },
  });
  const guidingContent = experience?.guidingContent;
  if (guidingContent == null) return null; // not a tour

  const parsed = parseGuidingContent(guidingContent);
  if (!parsed.ok) return null; // unparseable → no safe presentation

  const semantics = TOUR_PACKAGE_SEMANTICS[parsed.value.packageType];
  // A vehicle section is meaningful for a transport package, or a PRIVATE_CUSTOM_TOUR that
  // actually declared a vehicle (optional). GUIDE_ONLY never shows vehicles.
  const involvesVehicle = semantics.includesTransport || (semantics.vehicleOptional && parsed.value.vehicle !== null);
  if (!involvesVehicle) return null;

  const rows = await prisma.tourServiceVehicle.findMany({
    where: { serviceId },
    orderBy: [{ createdAt: "asc" }, { vehicleId: "asc" }],
    select: { vehicle: { select: POOL_VEHICLE_SELECT } },
  });

  // providerId is not consumed by the eligibility authority (it reads only package + maxGuests
  // + per-vehicle state); this is a public read, so it is intentionally left blank.
  const context = { serviceId, providerId: "", packageType: parsed.value.packageType, maxGuests: parsed.value.maxGuests };
  const now = new Date();

  const vehicles: PublicTourVehicle[] = rows
    .map((r) => evaluatePoolVehicle(r.vehicle as unknown as PoolVehicleRow, context, now))
    .filter((evaluated) => evaluated.blockers.length === 0)
    .map((evaluated) => {
      const v = evaluated.vehicle; // ProviderVehicleDTO — copy ONLY the customer-safe allowlist.
      return {
        make: v.make,
        model: v.model,
        modelYear: v.modelYear,
        color: v.color,
        passengerCapacity: v.passengerCapacity,
        vehicleType: v.vehicleType,
        isFourByFour: v.isFourByFour,
      };
    });

  return {
    transportIncluded: semantics.includesTransport,
    requiresFourByFour: semantics.requiresFourByFour,
    vehicles,
  };
}
