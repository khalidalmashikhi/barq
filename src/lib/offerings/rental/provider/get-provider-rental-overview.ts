import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import {
  RENTAL_VEHICLE_SELECT,
  assertRentalVehicleReady,
  type LoadedRentalVehicle,
} from "../rental-offering-authorization";
import { omanTodayDbDateBoundary } from "../rental-service-publishability";
import type { ProviderRentalOverview } from "./provider-rental-offering-dto";

// Phase 3C Slice C2d-R1 — the provider rental workspace OVERVIEW: authoritative operational counts
// derived entirely from the session provider's own data. Offering counts come from a grouped query;
// vehicle readiness reuses the same pure selectability authority the publish path uses; the upcoming
// availability count is a single scoped count. Nothing is invented — every number is derivable.
// READ-ONLY.

export async function getProviderRentalWorkspaceOverview(): Promise<ProviderRentalOverview> {
  const { provider } = await requireApprovedProvider();
  const now = new Date();
  const boundary = omanTodayDbDateBoundary(now);

  const [statusGroups, vehicles, upcomingOpenDays] = await Promise.all([
    prisma.rentalOffering.groupBy({
      by: ["status"],
      where: { service: { providerId: provider.id } },
      _count: { _all: true },
    }),
    prisma.vehicle.findMany({
      where: { asset: { providerId: provider.id, assetType: "VEHICLE" } },
      select: RENTAL_VEHICLE_SELECT,
    }),
    prisma.rentalOfferingDay.count({
      where: {
        state: "OPEN",
        serviceDate: { gte: boundary },
        rentalOffering: { service: { providerId: provider.id } },
      },
    }),
  ]);

  const countByStatus = new Map<string, number>();
  for (const group of statusGroups) countByStatus.set(group.status, group._count._all);
  const draftOfferings = countByStatus.get("DRAFT") ?? 0;
  const publishedOfferings = countByStatus.get("PUBLISHED") ?? 0;
  const suspendedOfferings = countByStatus.get("SUSPENDED") ?? 0;

  let vehiclesReadyForRental = 0;
  for (const vehicle of vehicles as unknown as LoadedRentalVehicle[]) {
    if (assertRentalVehicleReady(vehicle, now) === null) vehiclesReadyForRental += 1;
  }
  const vehiclesRequiringVerification = vehicles.length - vehiclesReadyForRental;

  return {
    totalOfferings: draftOfferings + publishedOfferings + suspendedOfferings,
    draftOfferings,
    publishedOfferings,
    suspendedOfferings,
    vehiclesReadyForRental,
    vehiclesRequiringVerification,
    upcomingOpenDays,
  };
}
