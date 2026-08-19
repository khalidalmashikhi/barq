import { getProviderVehicles } from "@/lib/vehicles/queries/get-provider-vehicles";
import { getProviderVehicle } from "@/lib/vehicles/queries/get-provider-vehicle";
import { createVehicle } from "@/lib/vehicles/create-vehicle";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderVehicleApiDTO } from "@/lib/api/v1/vehicle-dtos";
import { pickVehicleInput } from "@/lib/api/v1/vehicle-request";

// GET /api/v1/me/provider/vehicles — VEHICLE-1B (Provider Vehicle API).
//
// Thin adapter over getProviderVehicles(), which scopes strictly to the caller's
// own provider.id (never accepts a providerId) and returns the provider's whole
// fleet in ALL statuses (a provider manages their own vehicles). Private/no-store.
//
// POST /api/v1/me/provider/vehicles — creates a vehicle via createVehicle(): the
// domain derives providerId server-side, forces assetType=VEHICLE, starts status
// REGISTERED, and validates every field through its single strict contract. The
// route forwards ONLY the VEHICLE-1-authorized input fields (explicit allowlist
// below) — providerId/assetType/status can never be supplied by a client. On
// success it re-reads and returns the private DTO with 201.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.vehicles.list", () =>
    withApiV1Provider(request, async () => {
      const vehicles = await getProviderVehicles();
      return apiOk({ items: vehicles.map(toProviderVehicleApiDTO) });
    }),
  );
}

export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.provider.vehicles.create", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const body = await readJsonObject(request);
      const result = await createVehicle(pickVehicleInput(body));
      if (!result.ok) return vehicleErrorResponse(result.error, locale);

      // Just created and owned by this provider, so the ownership-scoped reader
      // should always find it; a null here is a genuine internal inconsistency.
      const detail = await getProviderVehicle(result.vehicleId);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderVehicleApiDTO(detail), { status: 201 });
    }),
  );
}
