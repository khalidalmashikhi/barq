import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { uploadProviderDocument } from "@/lib/provider/documents/upload-provider-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document UPLOAD — Gate 2 domain, Gate 3 progressive-form transport.
// Route handler (not a server action) so a multipart upload up to the 4 MB cap
// bypasses the 1 MB server-action body limit. Thin: parse multipart, delegate to
// the self-authorizing uploadProviderDocument() (requireProvider + registry type
// + magic-byte validation + private-bucket write), then redirect back to the
// verification page with a machine-readable status — exactly the progressive
// pattern the media routes use. Provider identity comes only from the auth
// context; there is no providerId input to trust.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request) {
  return withRequestTracing("provider.documents.upload", async () => {
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/verification${q}`, request.url);
    try {
      const type = formData.get("type");
      const file = formData.get("file");
      if (typeof type !== "string") return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
      if (!(file instanceof File) || file.size === 0) return NextResponse.redirect(dest("?docError=EMPTY_FILE"), 303);

      const result = await uploadProviderDocument({
        type,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=uploaded" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
