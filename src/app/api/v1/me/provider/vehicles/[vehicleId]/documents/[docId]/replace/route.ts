import { replaceVehicleDocument } from "@/lib/vehicles/documents/replace-vehicle-document";
import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleDocumentErrorResponse } from "@/lib/api/v1/vehicle-document-errors";
import { parseVehicleDocumentUpload } from "@/lib/api/v1/vehicle-document-request";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toVehicleVerificationApiDTO } from "@/lib/api/v1/vehicle-verification-dtos";

// POST /api/v1/me/provider/vehicles/{vehicleId}/documents/{docId}/replace — VEHICLE-LC2B.
//
// Native multipart replace of an existing document with a new immutable object (reset
// to PENDING). Thin adapter over the authoritative LC2 replaceVehicleDocument, which
// enforces provider ownership + path-binding (document.assetId === vehicleId), the
// PENDING/REJECTED-only + APPROVED-locked policy, RC3-safe swap (old object removed
// only after the DB points to the new one; new object cleaned up on race/failure).
// Malformed/missing multipart → stable 400 INVALID_INPUT (never 500/redirect).

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ vehicleId: string; docId: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.documents.replace", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { vehicleId, docId } = await params;

      const parsed = await parseVehicleDocumentUpload(request);
      if (!parsed.ok) return apiError("INVALID_INPUT", { locale });
      if (!parsed.file) return apiError("INVALID_INPUT", { locale, details: { reason: "EMPTY_FILE" } });

      const result = await replaceVehicleDocument(vehicleId, docId, parsed.file);
      if (!result.ok) return vehicleDocumentErrorResponse(result.error, locale);

      const data = await getVehicleVerificationData(vehicleId);
      if (!data) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toVehicleVerificationApiDTO(vehicleId, data));
    }),
  );
}
