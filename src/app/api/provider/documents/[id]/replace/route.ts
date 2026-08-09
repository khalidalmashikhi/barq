import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { replaceProviderDocument } from "@/lib/provider/documents/replace-provider-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document REPLACE — Gate 2 domain, Gate 3 progressive-form transport.
// Multipart route handler (new file up to 4 MB). Delegates to
// replaceProviderDocument() (self-authorizes + ownership; validates; uploads a
// NEW immutable object; swaps under the RC3 version-token + conditional guard).
// The opaque versionToken binds the replace to the object the client last saw;
// objectKey is never involved. Redirects back to the verification page.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("provider.documents.replace", async () => {
    const { id } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/verification${q}`, request.url);
    try {
      const versionToken = formData.get("versionToken");
      const file = formData.get("file");
      if (typeof versionToken !== "string") return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
      if (!(file instanceof File) || file.size === 0) return NextResponse.redirect(dest("?docError=EMPTY_FILE"), 303);

      const result = await replaceProviderDocument({
        documentId: id,
        expectedVersionToken: versionToken,
        originalFilename: file.name,
        declaredMimeType: file.type,
        bytes: await file.arrayBuffer(),
      });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=replaced" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
