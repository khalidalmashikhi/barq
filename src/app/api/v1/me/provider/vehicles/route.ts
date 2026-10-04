import { getProviderVehicles } from "@/lib/vehicles/queries/get-provider-vehicles";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderVehicleApiDTO } from "@/lib/api/v1/vehicle-dtos";

// GET /api/v1/me/provider/vehicles — VEHICLE-1B (Provider Vehicle API).
//
// Thin adapter over getProviderVehicles(), which scopes strictly to the caller's
// own provider.id (never accepts a providerId) and returns the provider's whole
// fleet in ALL statuses (a provider manages their own vehicles). Private/no-store.
//
// POST /api/v1/me/provider/vehicles — DIRECT CREATION IS CLOSED (Phase 3C Slice 3B).
// A vehicle is created only by uploading its registration document first and then
// reviewing + confirming the details (the document-first onboarding flow). This
// endpoint used to create a fully-described vehicle from a JSON body, which would
// bypass that flow, so it now authenticates the caller exactly as before and then
// returns 409 REGISTRATION_DOCUMENT_REQUIRED without creating anything. A native
// (JSON/multipart) document-first transport is a separate, future API gate.

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
    withApiV1ProviderMutation(request, async ({ locale }) => vehicleErrorResponse("REGISTRATION_DOCUMENT_REQUIRED", locale)),
  );
}
