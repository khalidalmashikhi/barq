import { requireAuth, UnauthenticatedError, ForbiddenError, type AuthContext } from "@/lib/auth";
import type { Locale } from "@/i18n/locales";
import { resolveApiLocale } from "./locale";
import { apiError } from "./errors";

// API v1 authenticated-session helper — Gate 2 (Authenticated Customer Read).
//
// ONE place that turns the EXISTING Better Auth session authority
// (requireAuth() → cookie session → resolveBarqUser) into an API v1 response.
// It NEVER introduces a second auth system, token, or bearer scheme — it only
// reuses requireAuth() and maps its thrown auth errors to the Gate-1 error
// envelope:
//   - UnauthenticatedError (no/expired session) → 401 { error: { code: "UNAUTHORIZED", ... } }
//   - ForbiddenError (e.g. SUSPENDED/DEACTIVATED account — USER_INACTIVE) → 403
// Anything else rethrows so it surfaces as a real 500 (never silently swallowed,
// never leaked as a stack trace to the client — withRequestTracing logs it
// server-side).
//
// Web auth behavior is untouched: requireAuth() is the same function the web
// Server Components/Actions already use; this helper only wraps it for the HTTP
// boundary. Route handlers do not duplicate the 401/403 mapping — they wrap
// their body in withApiV1Auth once.

export type ApiV1AuthContext = AuthContext & { locale: Locale };

/**
 * Run an authenticated API v1 handler. Resolves the current session via the
 * existing requireAuth() authority and passes the resolved BARQ user + request
 * locale to the handler; returns the Gate-1 error envelope on auth failure.
 */
export async function withApiV1Auth(
  request: Request,
  handler: (context: ApiV1AuthContext) => Promise<Response>
): Promise<Response> {
  const locale = resolveApiLocale(request);

  let auth: AuthContext;
  try {
    auth = await requireAuth();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return apiError("UNAUTHORIZED", { locale });
    if (error instanceof ForbiddenError) return apiError("FORBIDDEN", { locale });
    throw error;
  }

  return handler({ ...auth, locale });
}
