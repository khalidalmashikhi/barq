import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { uploadProviderDocument } from "@/lib/provider/documents/upload-provider-document";
import { providerDocumentErrorHttpStatus } from "@/lib/provider/documents/provider-document-errors";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document UPLOAD — Gate 2. Route handler (not a server action) to
// accept a multipart upload up to the 4 MB cap without touching the global 1 MB
// server-action body limit. Deliberately thin: parse multipart, delegate to the
// self-authorizing uploadProviderDocument() domain core (which enforces
// requireProvider, registry type, magic-byte validation, and private-bucket
// write), then return a machine-readable JSON result. Provider identity comes
// only from the authenticated context inside the domain — a client-supplied
// providerId is never trusted (there is no providerId input here).

export async function POST(request: Request) {
  return withRequestTracing("provider.documents.upload", async () => {
    try {
      const formData = await request.formData();
      const type = formData.get("type");
      const file = formData.get("file");

      if (typeof type !== "string") {
        return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
      }
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ ok: false, error: "EMPTY_FILE" }, { status: 400 });
      }

      const result = await uploadProviderDocument({
        type,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });

      if (!result.ok) {
        return NextResponse.json(result, { status: providerDocumentErrorHttpStatus(result.error) });
      }
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
      }
      throw error;
    }
  });
}
