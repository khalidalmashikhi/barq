import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { deleteProviderDocument } from "@/lib/provider/documents/delete-provider-document";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider document DELETE — Gate 2 domain, Gate 3 progressive-form transport.
// Delegates to deleteProviderDocument() (self-authorizes + ownership + RC3
// version-token/conditional guard; APPROVED documents are not deletable).
// Redirects back to the verification page.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("provider.documents.delete", async () => {
    const { id } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/verification${q}`, request.url);
    try {
      const versionToken = formData.get("versionToken");
      if (typeof versionToken !== "string") return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);

      const result = await deleteProviderDocument({ documentId: id, expectedVersionToken: versionToken });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=deleted" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
