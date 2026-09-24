import "server-only";
import { getLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { buildVehicleTitle } from "@/lib/vehicles/vehicle-title";
import { assertRentalVehicleReady } from "../rental-offering-authorization";
import { RENTAL_WORKSPACE_VEHICLE_SELECT, type LoadedWorkspaceVehicle } from "./provider-rental-readiness";
import { isRentalReadinessBlocker, type RentalReadinessBlockerCode } from "./rental-offering-status";

// Phase 3C Slice C2d-R1 Checkpoint B — bounded options for the create-offering form: the session
// provider's own VEHICLE_RENTAL services and own VEHICLE assets. Eligibility is server-derived
// (ownership + Service.offeringKind), NEVER inferred from categories; a guided-tour service or a
// guide-only vehicle can never appear (offeringKind gate + assetType gate). The authoritative create
// mutation re-validates everything (ownership, kind, capacity, draft vertical, (service,vehicle)
// uniqueness) — this list is UX only. Vehicle readiness is INFORMATIONAL (a draft may be created for
// a not-yet-ready vehicle; readiness is a publish requirement), so no vehicle is filtered out.
// READ-ONLY, bounded, deterministic order, no N+1.

export type RentalCreateServiceOption = { serviceId: string; serviceName: string };

export type RentalCreateVehicleOption = {
  vehicleId: string;
  title: string | null;
  vehicleType: string | null;
  bookablePassengerCapacity: number | null;
  registeredSeats: number | null;
  ready: boolean;
  readinessBlocker: RentalReadinessBlockerCode | null;
};

export type RentalCreateOptions = { services: RentalCreateServiceOption[]; vehicles: RentalCreateVehicleOption[] };

export async function getRentalCreateOptions(): Promise<RentalCreateOptions> {
  const { provider } = await requireApprovedProvider();
  const locale = await getLocale();
  const now = new Date();

  const [serviceRows, vehicleRows] = await Promise.all([
    prisma.service.findMany({
      where: { providerId: provider.id, offeringKind: "VEHICLE_RENTAL" },
      select: { id: true, name: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.vehicle.findMany({
      where: { asset: { providerId: provider.id, assetType: "VEHICLE" } },
      select: RENTAL_WORKSPACE_VEHICLE_SELECT,
      orderBy: [{ assetId: "desc" }],
    }),
  ]);

  const services: RentalCreateServiceOption[] = serviceRows.map((s) => ({
    serviceId: s.id,
    serviceName: extractLocalizedText(s.name, locale),
  }));

  const vehicles: RentalCreateVehicleOption[] = (vehicleRows as unknown as LoadedWorkspaceVehicle[]).map((v) => {
    const blocker = assertRentalVehicleReady(v, now);
    return {
      vehicleId: v.assetId,
      title: buildVehicleTitle(v.make, v.model),
      vehicleType: v.vehicleType,
      bookablePassengerCapacity: v.bookablePassengerCapacity,
      registeredSeats: v.registeredSeats,
      ready: blocker === null,
      readinessBlocker: blocker !== null && isRentalReadinessBlocker(blocker) ? blocker : null,
    };
  });

  return { services, vehicles };
}
