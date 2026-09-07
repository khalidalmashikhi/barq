import { NextResponse } from "next/server";
import { requireAuth, hasPermission, resolveProviderStatus, UnauthenticatedError } from "@/lib/auth";
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

    let barqUser;
    try {
      ({ barqUser } = await requireAuth());
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      throw error;
    }
    const barqUserId = barqUser.id;

    // STAFF RBAC (Gate Z-3) — an internal actor authorized to read verification documents
    // (OWNER/ADMIN, or a Staff member granted providerDocuments.read) may view ANY vehicle's
    // documents; everyone else is only the OWNING (active) provider. Authorization happens
    // BEFORE any signed URL is minted. A providers.review-only or booking/finance staff
    // WITHOUT providerDocuments.read falls through to the owning-provider path and gets a 404.
    let caller: VehicleDocumentCaller;
    if (await hasPermission(barqUser, "providerDocuments.read")) {
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
