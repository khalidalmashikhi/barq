import { requireApprovedProvider } from "@/lib/auth";
import {
  getVehicleDocumentSignedUrl,
  VEHICLE_DOC_SIGNED_URL_TTL_SECONDS,
} from "@/lib/vehicles/documents/get-vehicle-document-signed-url";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";

// GET /api/v1/me/provider/vehicles/{id}/documents/{docId}/view — VEHICLE-LC2B.
//
// Native-friendly private view: returns a SHORT-LIVED signed URL in JSON (rather than
// a browser redirect), minted only after provider ownership + path-binding
// (document.assetId === vehicleId). Thin adapter over the LC2 getVehicleDocumentSignedUrl;
// requireApprovedProvider() supplies the server-derived provider identity (its thrown
// auth errors are mapped by withApiV1Provider). The raw objectKey is NEVER returned;
// the URL is short-lived and never persisted; any of {no session, not approved, not
// owner, mismatched vehicle/doc, missing, storage off} → uniform 404 (never enumerable).

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  return withRequestTracing("api.v1.me.provider.vehicles.documents.view", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id: vehicleId, docId } = await params;
      const { provider } = await requireApprovedProvider(); // throws → mapped to 401/403 by the wrapper
      const view = await getVehicleDocumentSignedUrl(vehicleId, docId, { kind: "provider", providerId: provider.id });
      if (!view) return apiError("NOT_FOUND", { locale });
      return apiOk({ url: view.signedUrl, filename: view.filename, expiresInSeconds: VEHICLE_DOC_SIGNED_URL_TTL_SECONDS });
    }),
  );
}
