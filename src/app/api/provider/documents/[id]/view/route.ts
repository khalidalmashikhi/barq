import { NextResponse } from "next/server";
import { requireAuth, hasPermission, resolveProviderStatus, UnauthenticatedError } from "@/lib/auth";
import {
  getProviderDocumentSignedUrl,
  type DocumentCaller,
} from "@/lib/provider/documents/get-provider-document-signed-url";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document VIEW — Gate 2. Input is the document id ONLY. Authorizes the
// caller as either the OWNING provider or an admin, mints a 60-second signed URL
// server-side, and redirects to it. Any of {no session, not owner, not admin,
// suspended/deactivated provider, missing document, storage not configured}
// resolves to a UNIFORM 404 that never reveals a document's existence. The raw
// objectKey is never returned; the signed URL is never persisted; Cache-Control
// is no-store; the signed URL forces an attachment download (never inline).

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("provider.documents.view", async () => {
    const { id } = await ctx.params;

    let barqUser;
    try {
      ({ barqUser } = await requireAuth());
    } catch (error) {
      if (error instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      throw error;
    }
    const barqUserId = barqUser.id;

    // STAFF RBAC (Gate Z-3) — an internal actor authorized to read verification documents
    // (OWNER/ADMIN, or a Staff member granted providerDocuments.read) may view ANY provider's
    // documents; everyone else is only the OWNING (active) provider. Authorization happens
    // BEFORE any signed URL is minted (below). A booking/finance/etc. staff WITHOUT
    // providerDocuments.read falls through to the owning-provider path and gets a 404.
    let caller: DocumentCaller;
    if (await hasPermission(barqUser, "providerDocuments.read")) {
      caller = { kind: "admin" };
    } else {
      const lookup = await resolveProviderStatus(barqUserId);
      // "active" excludes SUSPENDED/DEACTIVATED → those are blocked (404).
      if (lookup.kind !== "active") return notFound();
      caller = { kind: "provider", providerId: lookup.provider.id };
    }

    const view = await getProviderDocumentSignedUrl(id, caller);
    if (!view) return notFound(); // missing / not-owned / storage not configured

    const response = NextResponse.redirect(view.signedUrl, 302);
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
