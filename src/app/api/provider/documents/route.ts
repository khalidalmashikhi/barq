import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { uploadProviderDocument } from "@/lib/provider/documents/upload-provider-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { wantsJson, jsonUploadResult, jsonUnauthenticated } from "./transport";

// Provider document UPLOAD — Gate 2 domain, Gate 3 progressive-form transport,
// Gate 0 additive JSON mode. Route handler (not a server action) so a multipart
// upload up to the 4 MB cap bypasses the 1 MB server-action body limit. Thin:
// parse multipart, delegate to the self-authorizing uploadProviderDocument()
// (requireProvider + registry type + magic-byte validation + private-bucket
// write). Provider identity comes only from the auth context; there is no
// providerId input to trust.
//
// TRANSPORT: content-negotiated. `Accept: application/json` (the polished
// auto-upload client, which needs a JSON result to drive real XHR progress) gets
// a JSON body; every other caller keeps the original progressive-<form> 303
// redirect back to the verification page. Same server validation/storage/DB/audit
// path either way — the mode only changes how the result is returned.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request) {
  return withRequestTracing("provider.documents.upload", async () => {
    const json = wantsJson(request);
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/verification${q}`, request.url);
    try {
      const type = formData.get("type");
      const file = formData.get("file");
      if (typeof type !== "string") {
        return json ? jsonUploadResult({ ok: false, error: "INVALID_INPUT" }) : NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
      }
      if (!(file instanceof File) || file.size === 0) {
        return json ? jsonUploadResult({ ok: false, error: "EMPTY_FILE" }) : NextResponse.redirect(dest("?docError=EMPTY_FILE"), 303);
      }

      const result = await uploadProviderDocument({
        type,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });
      if (json) return jsonUploadResult(result);
      return NextResponse.redirect(dest(result.ok ? "?docNotice=uploaded" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return json ? jsonUnauthenticated() : NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
