import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { deleteProviderDocument } from "@/lib/provider/documents/delete-provider-document";
import { providerDocumentErrorHttpStatus } from "@/lib/provider/documents/provider-document-errors";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document DELETE — Gate 2. Thin wrapper over deleteProviderDocument()
// (self-authorizes + ownership + RC3 version-token/conditional guard; APPROVED
// documents are not deletable). POST with a small JSON/form body carrying the
// opaque versionToken. Identity comes only from the authenticated context.

async function readVersionToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { versionToken?: unknown } | null;
    return typeof body?.versionToken === "string" ? body.versionToken : null;
  }
  const form = await request.formData().catch(() => null);
  const token = form?.get("versionToken");
  return typeof token === "string" ? token : null;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("provider.documents.delete", async () => {
    try {
      const { id } = await ctx.params;
      const versionToken = await readVersionToken(request);
      if (typeof versionToken !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
      }

      const result = await deleteProviderDocument({ documentId: id, expectedVersionToken: versionToken });
      return NextResponse.json(result, { status: result.ok ? 200 : providerDocumentErrorHttpStatus(result.error) });
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
      }
      throw error;
    }
  });
}
