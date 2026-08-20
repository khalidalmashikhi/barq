import { uploadVehicleDocument } from "@/lib/vehicles/documents/upload-vehicle-document";
import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleDocumentErrorResponse } from "@/lib/api/v1/vehicle-document-errors";
import { parseVehicleDocumentUpload } from "@/lib/api/v1/vehicle-document-request";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toVehicleVerificationApiDTO } from "@/lib/api/v1/vehicle-verification-dtos";

// POST /api/v1/me/provider/vehicles/{vehicleId}/documents — VEHICLE-LC2B.
//
// Native multipart upload of a required vehicle verification document. Thin adapter
// over the authoritative LC2 uploadVehicleDocument() (registry-allowlisted type +
// MIME + magic-byte + size validation + private-bucket write + ownership + editable
// state — all unchanged). Unlike the legacy Web route, malformed/missing multipart
// returns a stable JSON 400 INVALID_INPUT (never a 500 / redirect / HTML). On success
// we re-read the ownership-scoped checklist and return the updated verification state.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ vehicleId: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.documents.upload", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { vehicleId } = await params;

      const parsed = await parseVehicleDocumentUpload(request);
      if (!parsed.ok) return apiError("INVALID_INPUT", { locale }); // malformed / non-form body
      if (parsed.type === null) return apiError("INVALID_INPUT", { locale, details: { reason: "MISSING_TYPE" } });
      if (!parsed.file) return apiError("INVALID_INPUT", { locale, details: { reason: "EMPTY_FILE" } });

      const result = await uploadVehicleDocument(vehicleId, { type: parsed.type, ...parsed.file });
      if (!result.ok) return vehicleDocumentErrorResponse(result.error, locale);

      const data = await getVehicleVerificationData(vehicleId);
      if (!data) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toVehicleVerificationApiDTO(vehicleId, data), { status: 201 });
    }),
  );
}
