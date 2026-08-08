import { NextResponse } from "next/server";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { updateProviderLogo } from "@/lib/provider/media/update-provider-logo";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Provider logo upload endpoint (Media Foundation, Gap C).
//
// WHY A ROUTE HANDLER, NOT A SERVER ACTION: Next.js server actions run
// under a default 1 MB request-body limit; raising it (experimental.
// serverActions.bodySizeLimit) would loosen that ceiling for EVERY action
// app-wide. A dedicated route handler accepts the multipart upload without
// touching that global limit, and a plain <form method="post"
// enctype="multipart/form-data"> posts to it with no client JS — so the
// upload stays progressively enhanced, consistent with the rest of BARQ.
//
// The handler is deliberately thin: authenticate, parse, delegate to the
// testable updateProviderLogo() core, then redirect back to Settings with a
// machine-readable status code. All bytes flow browser → here → Supabase;
// the service-role key never reaches the browser.

const SUPPORTED_LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";

function resolveLocale(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? raw : DEFAULT_LOCALE;
}

export async function POST(request: Request) {
  return withRequestTracing("provider.media.logo", async () => {
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const settingsUrl = (query: string) => new URL(`/${locale}/provider/settings${query}`, request.url);

    let providerId: string;
    try {
      const { provider } = await requireProvider();
      providerId = provider.id;
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.redirect(settingsUrl("?logoError=NO_PROVIDER_PROFILE"), 303);
      }
      throw error;
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.redirect(settingsUrl("?logoError=EMPTY_FILE"), 303);
    }

    const result = await updateProviderLogo(file, providerId);
    return NextResponse.redirect(
      settingsUrl(result.ok ? "?logoSaved=1" : `?logoError=${result.error}`),
      303
    );
  });
}
