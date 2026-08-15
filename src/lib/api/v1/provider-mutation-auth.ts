import { requireProvider } from "@/lib/auth";
import type { Locale } from "@/i18n/locales";
import { resolveApiLocale } from "./locale";
import { providerAuthErrorResponse } from "./provider-auth-error";

// API v1 provider MUTATION gate — Gate PC (Provider Mutation API).
//
// WHY THIS DIFFERS FROM withApiV1Provider (the read gate):
// The provider mutation server actions (create/update/publish service, availability
// CRUD, booking accept/reject/start/complete, profile update) each handle an
// unauthenticated session by calling `redirect("/")` — a browser-form convenience
// that, inside a route handler, would throw NEXT_REDIRECT and emit a 307 instead of
// a clean JSON 401. So this wrapper PRE-AUTHENTICATES with requireProvider() BEFORE
// invoking the action: if there is no valid session the wrapper returns 401 here and
// the action is never reached, so its redirect path is unreachable. When the session
// IS valid, each action re-resolves the provider from that same session and applies
// its OWN stricter gate internally (requireApprovedProvider for service/availability
// mutations) — returning a normal result code (e.g. PROVIDER_NOT_APPROVED) that the
// route maps via provider-mutation-errors.ts, never a redirect.
//
// It reuses requireProvider() (the LOOSEST gate any provider mutation uses, so an
// APPLIED provider is admitted here and then correctly told PROVIDER_NOT_APPROVED by
// an approved-only action, rather than being blocked at the wrapper). It NEVER
// introduces a token/bearer/second auth system — same session-cookie identity as the
// rest of the app. The auth-error → envelope mapping is shared with withApiV1Provider
// via providerAuthErrorResponse (see that module for the exact code table).

export async function withApiV1ProviderMutation(
  request: Request,
  handler: (context: { locale: Locale }) => Promise<Response>
): Promise<Response> {
  const locale = resolveApiLocale(request);

  try {
    // Pre-auth: validates the session + provider row and blocks SUSPENDED/DEACTIVATED
    // exactly like the web provider pages. Guarantees the action never hits its own
    // unauthenticated redirect("/") path.
    await requireProvider();
    return await handler({ locale });
  } catch (error) {
    const mapped = providerAuthErrorResponse(error, locale);
    if (mapped) return mapped;
    throw error;
  }
}
