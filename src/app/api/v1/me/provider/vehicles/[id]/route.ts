import { getProviderVehicle } from "@/lib/vehicles/queries/get-provider-vehicle";
import { updateVehicle } from "@/lib/vehicles/update-vehicle";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderVehicleApiDTO } from "@/lib/api/v1/vehicle-dtos";
import { pickVehicleInput } from "@/lib/api/v1/vehicle-request";

// GET /api/v1/me/provider/vehicles/{id} — VEHICLE-1B.
//
// getProviderVehicle() queries by BOTH the vehicle id AND the caller's own
// provider.id, returning null uniformly for invalid/missing/not-owned -> 404. A
// provider can never read another provider's vehicle by guessing an id. Private.
//
// PATCH /api/v1/me/provider/vehicles/{id} — updates via updateVehicle(), which
// re-checks ownership (foreign/missing -> uniform VEHICLE_NOT_FOUND -> 404) and
// mutates only the VEHICLE-1-authorized fields. providerId/assetType/status are
// NEVER accepted (the same explicit allowlist as create); status lifecycle is a
// separate deferred concern (there is no status endpoint). On success it re-reads
// and returns the private DTO.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.detail", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id } = await params;
      const detail = await getProviderVehicle(id);
      if (!detail) return apiError("NOT_FOUND", { locale });
      return apiOk(toProviderVehicleApiDTO(detail));
    }),
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.update", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const result = await updateVehicle(id, pickVehicleInput(body));
      if (!result.ok) return vehicleErrorResponse(result.error, locale);

      const detail = await getProviderVehicle(id);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderVehicleApiDTO(detail));
    }),
  );
}
