import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { reviewProviderDocument, type ReviewDecision } from "@/lib/provider/documents/review-provider-document";
import { providerDocumentErrorHttpStatus } from "@/lib/provider/documents/provider-document-errors";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Admin document REVIEW — Gate 2. Thin wrapper over reviewProviderDocument()
// (self-authorizes via requireAdmin; RC3 version-token stale protection bound to
// the exact reviewed object; mandatory trimmed reason on reject). Admin identity
// comes only from the authenticated context. No approval-completeness gate and
// no PROVIDER_DOCUMENT_REJECTED notification here — those are Gate 3.

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("admin.provider_documents.review", async () => {
    try {
      const { id } = await ctx.params;
      const body = (await request.json().catch(() => null)) as
        | { decision?: unknown; reason?: unknown; versionToken?: unknown }
        | null;

      const decision = body?.decision;
      const versionToken = body?.versionToken;
      if ((decision !== "APPROVE" && decision !== "REJECT") || typeof versionToken !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
      }

      const result = await reviewProviderDocument({
        documentId: id,
        expectedVersionToken: versionToken,
        decision: decision as ReviewDecision,
        reason: typeof body?.reason === "string" ? body.reason : undefined,
      });

      return NextResponse.json(result, { status: result.ok ? 200 : providerDocumentErrorHttpStatus(result.error) });
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
      }
      throw error;
    }
  });
}
