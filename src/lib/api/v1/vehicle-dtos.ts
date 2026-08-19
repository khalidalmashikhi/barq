import type { AssetStatus } from "@prisma/client";
import type { ProviderVehicleDTO } from "@/lib/vehicles/vehicle-dto";

// VEHICLE-1B — the API v1 WIRE shape for a provider-private vehicle. A thin,
// explicit allowlist over the domain ProviderVehicleDTO (which is itself already
// a non-raw, allowlisted projection): it never touches a Prisma row, and here we
// additionally serialize the Date timestamps to deterministic ISO-8601 strings so
// Swift/Kotlin clients get a stable JSON contract.
//
// This is the PROVIDER-PRIVATE view, so it MAY carry registrationNumber and
// status. There is no public vehicle API in this gate; the public projection
// (get-public-vehicle) stays unwired for a future Tour/Service surface.

export type ProviderVehicleApiDTO = {
  id: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  passengerCapacity: number | null;
  publicDescription: string | null;
  registrationNumber: string | null;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
};

export function toProviderVehicleApiDTO(v: ProviderVehicleDTO): ProviderVehicleApiDTO {
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    modelYear: v.modelYear,
    color: v.color,
    vehicleType: v.vehicleType,
    passengerCapacity: v.passengerCapacity,
    publicDescription: v.publicDescription,
    registrationNumber: v.registrationNumber,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
