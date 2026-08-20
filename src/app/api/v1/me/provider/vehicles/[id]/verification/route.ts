import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toVehicleVerificationApiDTO } from "@/lib/api/v1/vehicle-verification-dtos";

// GET /api/v1/me/provider/vehicles/{id}/verification — VEHICLE-LC2B.
//
// Thin adapter over the LC2 read model getVehicleVerificationData(), which resolves
// the vehicle by BOTH id AND the caller's own provider.id (foreign/missing/invalid →
// null → uniform 404, never enumerable) and requires an approved provider (the read
// model throws the standard auth errors, mapped to the envelope by withApiV1Provider).
// The DTO is objectKey-free and admin-field-free; the two axes (operationalStatus vs
// verificationStatus) are surfaced separately. Private / no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.verification", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id: vehicleId } = await params;
      const data = await getVehicleVerificationData(vehicleId);
      if (!data) return apiError("NOT_FOUND", { locale });
      return apiOk(toVehicleVerificationApiDTO(vehicleId, data));
    }),
  );
}
