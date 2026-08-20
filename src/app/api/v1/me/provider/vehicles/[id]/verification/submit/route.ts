import { submitVehicleVerification } from "@/lib/vehicles/documents/submit-vehicle-verification";
import { getVehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { vehicleDocumentErrorResponse } from "@/lib/api/v1/vehicle-document-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toVehicleVerificationApiDTO } from "@/lib/api/v1/vehicle-verification-dtos";

// POST /api/v1/me/provider/vehicles/{id}/verification/submit — VEHICLE-LC2B.
//
// Thin adapter over the authoritative LC2 submitVehicleVerification(): it derives the
// provider server-side, enforces ownership, checks presence-only readiness, and does
// the optimistic DRAFT/CHANGES_REQUESTED → SUBMITTED transition (idempotent). It NEVER
// sets Asset.status ACTIVE and NEVER writes verificationStatus APPROVED. On success we
// re-read the ownership-scoped checklist and return the resulting verification state.
// NOT_READY carries the submission blockers in details.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.verification.submit", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id: vehicleId } = await params;
      const result = await submitVehicleVerification(vehicleId);
      if (!result.ok) {
        const details = result.error === "NOT_READY" ? { blockers: result.blockers } : undefined;
        return vehicleDocumentErrorResponse(result.error, locale, details);
      }
      const data = await getVehicleVerificationData(vehicleId);
      if (!data) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toVehicleVerificationApiDTO(vehicleId, data));
    }),
  );
}
