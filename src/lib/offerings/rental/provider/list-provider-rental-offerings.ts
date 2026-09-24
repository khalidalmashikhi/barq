import "server-only";
import type { Prisma } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { omanDateKeyFromDbDate } from "@/lib/date/oman-time";
import { assertRentalVerticalCompliant } from "../rental-offering-authorization";
import { omanTodayDbDateBoundary } from "../rental-service-publishability";
import { RENTAL_WORKSPACE_VEHICLE_SELECT, resolveRentalReadinessBlocker, type LoadedWorkspaceVehicle } from "./provider-rental-readiness";
import type { ProviderRentalOfferingListItem } from "./provider-rental-offering-dto";

// Phase 3C Slice C2d-R1 — list the SESSION provider's own rental offerings for the management
// workspace. Ownership is a where-clause predicate (service.providerId = the approved session
// provider), so a foreign offering is simply never returned — never a thrown enumeration signal.
// requireApprovedProvider() is the real, independent security boundary (the layout gate is only
// defense-in-depth). Vertical compliance is read ONCE (provider-global); the nearest upcoming OPEN
// day is resolved in ONE grouped query (no per-offering N+1). READ-ONLY: no mutation, no audit.

export async function listProviderRentalOfferings(): Promise<ProviderRentalOfferingListItem[]> {
  const { provider } = await requireApprovedProvider();
  const locale = await getLocale();
  const now = new Date();

  const rows = await prisma.rentalOffering.findMany({
    where: { service: { providerId: provider.id } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      serviceId: true,
      vehicleId: true,
      status: true,
      baseDailyAmount: true,
      currency: true,
      offeringCapacityOverride: true,
      service: { select: { name: true } },
      vehicle: { select: RENTAL_WORKSPACE_VEHICLE_SELECT },
    },
  });
  if (rows.length === 0) return [];

  // Vertical compliance is a provider-global fact — evaluate exactly once for the whole list.
  const verticalBlocker = await assertRentalVerticalCompliant(prisma, provider.id);

  // Nearest upcoming OPEN day per offering — one grouped, ordered query; reduce to the earliest.
  const boundary = omanTodayDbDateBoundary(now);
  const openDays = await prisma.rentalOfferingDay.findMany({
    where: { rentalOfferingId: { in: rows.map((r) => r.id) }, state: "OPEN", serviceDate: { gte: boundary } },
    select: { rentalOfferingId: true, serviceDate: true },
    orderBy: { serviceDate: "asc" },
  });
  const nearestByOffering = new Map<string, string>();
  for (const day of openDays) {
    if (!nearestByOffering.has(day.rentalOfferingId)) {
      nearestByOffering.set(day.rentalOfferingId, omanDateKeyFromDbDate(day.serviceDate));
    }
  }

  return rows.map((row) => {
    const vehicle = row.vehicle as unknown as LoadedWorkspaceVehicle;
    const baseAmount = row.baseDailyAmount as Prisma.Decimal;
    const capacity = vehicle.bookablePassengerCapacity;
    return {
      id: row.id,
      status: row.status,
      serviceId: row.serviceId,
      serviceName: extractLocalizedText(row.service.name, locale),
      vehicleId: row.vehicleId,
      vehicleTitle: buildVehicleTitle(vehicle.make, vehicle.model),
      vehicleType: vehicle.vehicleType,
      bookablePassengerCapacity: capacity,
      offeringCapacityOverride: row.offeringCapacityOverride,
      effectiveCapacity: row.offeringCapacityOverride ?? capacity,
      baseDailyAmount: baseAmount.toFixed(2),
      currency: row.currency,
      nearestOpenDateKey: nearestByOffering.get(row.id) ?? null,
      readinessBlocker: resolveRentalReadinessBlocker(verticalBlocker, vehicle, now),
    };
  });
}
