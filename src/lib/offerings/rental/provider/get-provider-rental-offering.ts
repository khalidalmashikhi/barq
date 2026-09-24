import "server-only";
import type { Prisma } from "@prisma/client";
import { getLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { omanDateKeyFromDbDate, omanDateKey } from "@/lib/date/oman-time";
import { assertRentalVerticalCompliant } from "../rental-offering-authorization";
import { omanTodayDbDateBoundary } from "../rental-service-publishability";
import { MAX_CALENDAR_WINDOW_DAYS } from "../../calendar/offering-calendar-types";
import { RENTAL_WORKSPACE_VEHICLE_SELECT, resolveRentalReadinessBlocker, type LoadedWorkspaceVehicle } from "./provider-rental-readiness";
import type { ProviderRentalOfferingDay, ProviderRentalOfferingDetail } from "./provider-rental-offering-dto";

// Phase 3C Slice C2d-R1 — read ONE rental offering the SESSION provider owns, with its configured
// days and each day's authoritative resolved price (override ?? base). A missing / foreign offering
// resolves to null (non-enumerating) — ownership is a where-clause predicate. requireApprovedProvider
// is the real security boundary. READ-ONLY: no mutation, no audit, no start-time exposure.

export async function getProviderRentalOfferingWithDays(offeringId: string): Promise<ProviderRentalOfferingDetail | null> {
  const { provider } = await requireApprovedProvider();
  const locale = await getLocale();
  const now = new Date();

  // BOUNDED forward window: only the configurable/manageable days [today, today + MAX window) are
  // returned — the same inclusive span C2b bulk-open allows. Past days are immutable history and are
  // never shown in the management calendar, so the query can never fan out unbounded day history.
  const boundary = omanTodayDbDateBoundary(now);
  const windowEnd = new Date(boundary.getTime() + MAX_CALENDAR_WINDOW_DAYS * 86_400_000);

  const row = await prisma.rentalOffering.findFirst({
    where: { id: offeringId, service: { providerId: provider.id } },
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
      days: {
        where: { serviceDate: { gte: boundary, lt: windowEnd } },
        select: { serviceDate: true, state: true, dailyAmountOverride: true },
        orderBy: { serviceDate: "asc" },
      },
    },
  });
  if (!row) return null;

  const vehicle = row.vehicle as unknown as LoadedWorkspaceVehicle;
  const base = row.baseDailyAmount as Prisma.Decimal;
  const baseString = base.toFixed(2);

  const verticalBlocker = await assertRentalVerticalCompliant(prisma, provider.id);

  // OPEN is provider CONFIGURATION state, not reservation-aware customer availability.
  let upcomingConfiguredOpenDays = 0;
  const configuredDays: ProviderRentalOfferingDay[] = (row.days as { serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null }[]).map((day) => {
    const override = day.dailyAmountOverride;
    if (day.state === "OPEN" && day.serviceDate >= boundary) upcomingConfiguredOpenDays += 1;
    return {
      dateKey: omanDateKeyFromDbDate(day.serviceDate),
      state: day.state,
      dailyAmount: override !== null ? override.toFixed(2) : baseString,
      currency: row.currency,
      priceSource: override !== null ? "OVERRIDE" : "BASE",
    };
  });

  const capacity = vehicle.bookablePassengerCapacity;
  return {
    id: row.id,
    status: row.status,
    serviceId: row.serviceId,
    serviceName: extractLocalizedText(row.service.name, locale),
    vehicleId: row.vehicleId,
    vehicleTitle: buildVehicleTitle(vehicle.make, vehicle.model),
    vehicleType: vehicle.vehicleType,
    vehicleColor: vehicle.color,
    vehicleModelYear: vehicle.modelYear,
    bookablePassengerCapacity: capacity,
    registeredSeats: vehicle.registeredSeats,
    offeringCapacityOverride: row.offeringCapacityOverride,
    effectiveCapacity: row.offeringCapacityOverride ?? capacity,
    baseDailyAmount: baseString,
    currency: row.currency,
    readinessBlocker: resolveRentalReadinessBlocker(verticalBlocker, vehicle, now),
    configuredDays,
    upcomingConfiguredOpenDays,
    todayKey: omanDateKey(now),
    windowDays: MAX_CALENDAR_WINDOW_DAYS,
  };
}
