import "server-only";
import { NextResponse } from "next/server";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Shared plumbing for the authenticated provider-media route handlers
// (cover, portfolio, delete) — Media Foundation, Gap C. Each route is a
// native multipart form POST that authenticates, runs its operation, then
// redirects back to Settings with a machine-readable status query. Kept
// here so the auth/locale/redirect dance isn't copy-pasted per route.

const SUPPORTED_LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";

function resolveLocale(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(raw) ? raw : DEFAULT_LOCALE;
}

export async function withProviderMediaRoute(
  request: Request,
  traceName: string,
  run: (args: { formData: FormData; providerId: string; locale: string }) => Promise<string>
): Promise<Response> {
  return withRequestTracing(traceName, async () => {
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const settingsUrl = (query: string) => new URL(`/${locale}/provider/settings${query}`, request.url);

    let providerId: string;
    try {
      providerId = (await requireProvider()).provider.id;
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.redirect(settingsUrl("?mediaError=NO_PROVIDER_PROFILE"), 303);
      }
      throw error;
    }

    const query = await run({ formData, providerId, locale });
    return NextResponse.redirect(settingsUrl(query), 303);
  });
}
