import { getTourServiceVehiclePoolView } from "@/lib/tour-template/vehicle-pool/pool-view";
import { removeVehicleFromTourServicePool } from "@/lib/tour-template/vehicle-pool/remove-vehicle-from-tour-service-pool";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { tourVehiclePoolErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";

// DELETE /api/v1/me/provider/services/{id}/vehicle-pool/{vehicleId} — TOUR-VEHICLE-2.
//
// Thin adapter over removeVehicleFromTourServicePool(), which re-derives the provider
// server-side and scopes the delete by the owning provider (foreign/missing service →
// uniform 404). Idempotent: removing an absent row succeeds. On success re-reads and
// returns the updated pool view.

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; vehicleId: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.vehicle-pool.remove", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id, vehicleId } = await params;

      const result = await removeVehicleFromTourServicePool(id, vehicleId);
      if (!result.ok) return tourVehiclePoolErrorResponse(result.error, locale);

      const view = await getTourServiceVehiclePoolView(id);
      if (!view) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(view);
    }),
  );
}
