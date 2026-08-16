import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { submitProviderVerification } from "@/lib/provider/submit-provider-verification";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Gate 1A — explicit "Submit for verification" transport. Thin: delegates to the
// self-authorizing submitProviderVerification() (requireProvider + readiness +
// DRAFT->UNDER_REVIEW). Content-negotiated like the Gate 0 document routes: a
// progressive <form> POST gets a 303 redirect back to the verification page; an
// XHR/`Accept: application/json` caller gets a JSON result. Provider identity comes
// only from the session — there is no providerId input to trust.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null | undefined): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request) {
  return withRequestTracing("provider.verification.submit", async () => {
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
    const formData = await request.formData().catch(() => null);
    const locale = resolveLocale(formData?.get("locale"));
    const dest = (q: string) => new URL(`/${locale}/provider/verification${q}`, request.url);
    try {
      const result = await submitProviderVerification();
      if (wantsJson) {
        const status = result.ok ? 200 : result.error === "NO_PROVIDER_PROFILE" ? 403 : 409;
        return NextResponse.json(result, { status });
      }
      return NextResponse.redirect(dest(result.ok ? "?vNotice=submitted" : `?vError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return wantsJson
          ? NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 })
          : NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
