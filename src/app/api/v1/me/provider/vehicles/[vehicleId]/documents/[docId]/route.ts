import { deleteVehicleDocument } from "@/lib/vehicles/documents/delete-vehicle-document";
import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleDocumentErrorResponse } from "@/lib/api/v1/vehicle-document-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toVehicleVerificationApiDTO } from "@/lib/api/v1/vehicle-verification-dtos";

// DELETE /api/v1/me/provider/vehicles/{vehicleId}/documents/{docId} — VEHICLE-LC2B.
//
// Thin adapter over the authoritative LC2 deleteVehicleDocument(vehicleId, docId),
// which enforces provider ownership AND the hardened path-binding (document.assetId
// === vehicleId) with uniform not-found, plus the PENDING/REJECTED-only + APPROVED-
// locked policy and safe post-commit object cleanup. On success we return the updated
// ownership-scoped checklist state.

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ vehicleId: string; docId: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.documents.delete", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { vehicleId, docId } = await params;
      const result = await deleteVehicleDocument(vehicleId, docId);
      if (!result.ok) return vehicleDocumentErrorResponse(result.error, locale);

      const data = await getVehicleVerificationData(vehicleId);
      if (!data) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toVehicleVerificationApiDTO(vehicleId, data));
    }),
  );
}
