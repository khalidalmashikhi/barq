import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Session } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";

// POST /api/v1/me/sign-out — native-safe session sign-out.
//
// WHY THIS EXISTS. Better Auth's own POST /api/auth/sign-out cannot be called by a
// native client. Verified against the installed Better Auth 1.6.23:
// `originCheckMiddleware` is registered by createRouter() as a GLOBAL router
// middleware on "/**" (dist/api/index.mjs), so it covers /sign-out with no
// exemption. Its validateOrigin() gates on COOKIE PRESENCE — `useCookies =
// headers.has("cookie")` — and then rejects a request whose Origin/Referer is
// empty with FORBIDDEN / MISSING_OR_NULL_ORIGIN. A browser passes because it always
// sends Origin; a native client sends the session cookie with no Origin and is
// refused. That check is correct CSRF protection for a cookie-authenticated
// browser endpoint and is deliberately left untouched.
//
// The same trace explains why OTP already works natively: /phone-number/send-otp
// and /verify are called WITHOUT cookies, so `useCookies` is false and
// validateOrigin() returns early before the Origin requirement.
//
// WHY THIS ROUTE IS SAFE. It lives on /api/v1, which Better Auth's router never
// serves, so no Origin is required to reach it — and it is not a CSRF hole: the
// only thing an attacker could achieve by forging it is signing the victim out,
// which destroys no data and grants no access.
//
// Server-side invalidation is delegated to Better Auth's own supported server API
// (`auth.api.signOut`), NOT reimplemented. Session internals — how the token is
// signed, which row is deleted, how the cookie is expired — stay entirely inside
// Better Auth. `auth.api.*` endpoints come from getEndpoints(), which is the
// pre-router object: createRouter() is what attaches originCheckMiddleware, so a
// direct server-side call never passes through it. (Belt and braces: both
// originCheckMiddleware and validateOrigin() also return early when `ctx.request`
// is absent, which it is for a direct call.)
//
// EXISTING BEHAVIOUR IS UNCHANGED. /api/auth/sign-out is untouched and remains what
// BARQ Web uses. This route is additive and versioned. No trustedOrigins change, no
// CSRF weakening, no bearer/JWT, no schema change.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.sign-out", () =>
    // AUTHENTICATION ONLY — deliberately withApiV1Session, not withApiV1Auth.
    //
    // Signing out is only meaningful for a caller who is actually signed in, so a
    // valid Better Auth session is still required and an absent/expired one is
    // still 401 UNAUTHORIZED. But it must NOT require an ACTIVE BARQ account.
    // requireAuth()'s SUSPENDED/DEACTIVATED denylist previously returned 403 here
    // before auth.api.signOut() could run, which meant a punished account could
    // not invalidate its own still-valid session — it survived until natural
    // expiry. Sign-out reduces access and grants nothing, so status is the wrong
    // gate for it. Every other /api/v1 route keeps the full status gate.
    withApiV1Session(request, async () => {
      // `returnHeaders: true` hands back the Set-Cookie Better Auth generated for
      // the expired session cookie, so the deletion is authored by Better Auth
      // rather than hand-rolled here (name, __Secure- prefix, Path, SameSite and
      // Secure all stay whatever the Better Auth config produces).
      //
      // Deliberately NOT wrapped in try/catch: if Better Auth fails to delete the
      // session row, the caller must NOT be told it succeeded. The error propagates
      // to a 500 so the client keeps its session and can retry, rather than
      // clearing locally while the server session stays alive for up to 7 days.
      const { headers: authHeaders } = await auth.api.signOut({
        headers: await headers(),
        returnHeaders: true,
      });

      const response = apiOk({ success: true });
      // getSetCookie() preserves EVERY Set-Cookie separately — joining them into
      // one header would corrupt cookie deletion if Better Auth ever emits more
      // than one (e.g. a session-data cookie alongside the token).
      for (const cookie of authHeaders.getSetCookie()) {
        response.headers.append("set-cookie", cookie);
      }
      return response;
    })
  );
}
