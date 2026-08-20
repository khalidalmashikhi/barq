import { NextResponse } from "next/server";
import { requireAuth, hasActiveAdminProfile, resolveProviderStatus, UnauthenticatedError } from "@/lib/auth";
import { getVehicleDocumentSignedUrl, type VehicleDocumentCaller } from "@/lib/vehicles/documents/get-vehicle-document-signed-url";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// VEHICLE-LC2 — vehicle-document VIEW. Input is the document id (the vehicleId in
// the path is only for URL clarity; ownership is resolved by docId → Asset →
// Provider). Authorizes the caller as an active admin OR the OWNING active
// provider, mints a 60-second signed URL, and redirects to it. Any of {no session,
// not owner, not admin, suspended/deactivated provider, missing document, storage
// not configured} → a UNIFORM 404 that never reveals a document's existence. Raw
// objectKey is never returned; the signed URL forces an attachment download.

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function GET(_request: Request, ctx: { params: Promise<{ vehicleId: string; docId: string }> }) {
  return withRequestTracing("provider.vehicles.documents.view", async () => {
    const { vehicleId, docId } = await ctx.params;

    let barqUserId: string;
    try {
      ({ barqUser: { id: barqUserId } } = await requireAuth());
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      throw error;
    }

    let caller: VehicleDocumentCaller;
    if (await hasActiveAdminProfile(barqUserId)) {
      caller = { kind: "admin" };
    } else {
      const lookup = await resolveProviderStatus(barqUserId);
      if (lookup.kind !== "active") return notFound();
      caller = { kind: "provider", providerId: lookup.provider.id };
    }

    const view = await getVehicleDocumentSignedUrl(vehicleId, docId, caller);
    if (!view) return notFound();

    const response = NextResponse.redirect(view.signedUrl, 302);
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
