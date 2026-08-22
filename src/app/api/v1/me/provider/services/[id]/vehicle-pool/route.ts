import { getTourServiceVehiclePoolView } from "@/lib/tour-template/vehicle-pool/pool-view";
import { addVehicleToTourServicePool } from "@/lib/tour-template/vehicle-pool/add-vehicle-to-tour-service-pool";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { tourVehiclePoolErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, coerceField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";

// GET /api/v1/me/provider/services/{id}/vehicle-pool — TOUR-VEHICLE-2 (provider read).
//
// Thin adapter over getTourServiceVehiclePoolView(), which scopes by the caller's own
// provider.id and returns null uniformly for an invalid/missing/not-owned/non-tour
// service → 404. Returns the SLIM pool DTO: the configured pool + eligible-to-add
// candidates, each with live eligibility/blockers. Never leaks registrationNumber,
// objectKey, documents, admin identity, or the raw trusted flag (see PoolVehicleView).
//
// POST /api/v1/me/provider/services/{id}/vehicle-pool — TOUR-VEHICLE-2 (provider add).
//
// Body: { "vehicleId": "<uuid>" }. Thin adapter over addVehicleToTourServicePool(), which
// re-derives the provider server-side, re-checks ownership (uniform 404), package
// eligibility, and LIVE vehicle assignment eligibility — a client-supplied eligibility
// flag / providerId is never trusted. Idempotent (a duplicate add succeeds). On success
// re-reads and returns the updated pool view.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.vehicle-pool.list", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id } = await params;
      const view = await getTourServiceVehiclePoolView(id);
      if (!view) return apiError("NOT_FOUND", { locale });
      return apiOk(view);
    }),
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.vehicle-pool.add", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const vehicleId = coerceField(body.vehicleId) ?? "";

      const result = await addVehicleToTourServicePool(id, vehicleId);
      if (!result.ok) return tourVehiclePoolErrorResponse(result.error, locale);

      const view = await getTourServiceVehiclePoolView(id);
      if (!view) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(view, { status: 201 });
    }),
  );
}
