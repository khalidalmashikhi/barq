import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { replaceProviderDocument } from "@/lib/provider/documents/replace-provider-document";
import { providerDocumentErrorHttpStatus } from "@/lib/provider/documents/provider-document-errors";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document REPLACE — Gate 2. Multipart route handler (new file up to
// 4 MB). Thin wrapper over replaceProviderDocument(), which self-authorizes
// (requireProvider + ownership), validates the new file, uploads a NEW immutable
// object, and swaps the DB reference under the RC3 version-token + conditional
// guard. The `versionToken` binds the replace to the object the client last saw
// (opaque; never the raw objectKey). Identity comes only from the authenticated
// context.

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("provider.documents.replace", async () => {
    try {
      const { id } = await ctx.params;
      const formData = await request.formData();
      const versionToken = formData.get("versionToken");
      const file = formData.get("file");

      if (typeof versionToken !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
      }
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ ok: false, error: "EMPTY_FILE" }, { status: 400 });
      }

      const result = await replaceProviderDocument({
        documentId: id,
        expectedVersionToken: versionToken,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
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
