import { requireAuth, getSession, UnauthenticatedError, ForbiddenError, type AuthContext } from "@/lib/auth";
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

/**
 * Run an API v1 handler that requires only a VALID BETTER AUTH SESSION — not an
 * active BARQ account.
 *
 * WHY THIS EXISTS, and why it is not a weakening of withApiV1Auth.
 *
 * requireAuth() deliberately fuses two questions: "is this request
 * authenticated?" and "is this BARQ account allowed to use the product?" — the
 * SUSPENDED/DEACTIVATED denylist. Fusing them is exactly right for every
 * capability route, and withApiV1Auth above is unchanged.
 *
 * It is wrong for sign-out. A punished account keeps a VALID Better Auth session
 * until it expires (up to 7 days), so gating sign-out on account status meant the
 * one user who most needs to destroy their session was the one user who could
 * not: auth.api.signOut() was never reached and the session outlived the
 * suspension. Sign-out grants no capability and reduces access, so it must not
 * require capability-level status.
 *
 * SCOPE IS DELIBERATELY NARROW. This is a separate wrapper, not a flag on
 * withApiV1Auth, so it can never be reached by accident: a route opts into
 * authentication-only semantics explicitly, and every other /api/v1 route keeps
 * the full status gate with no change to its code path.
 *
 * NO BARQ USER IS RESOLVED. Unlike requireAuth() this never calls
 * resolveBarqUser(), which is both unnecessary here and safer: that bridge can
 * CREATE a BARQ User + Customer as a side effect, and signing out must never
 * create an account. Better Auth's own getSession() is the sole authority, so no
 * session parsing is duplicated and no session row is touched directly.
 *
 * An absent, malformed, or expired session yields 401 — Better Auth returns null
 * for all three and does not distinguish them. Anonymous callers are refused;
 * they never reach the handler.
 */
export async function withApiV1Session(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const session = await getSession();

  if (!session) {
    return apiError("UNAUTHORIZED", { locale: resolveApiLocale(request) });
  }

  return handler();
}
