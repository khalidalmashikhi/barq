import { NextResponse } from "next/server";

// API v1 success responses — Gate 1 (Public API Foundation).
//
// CACHING POLICY (conservative, per the Gate-1 contract): every `/api/v1`
// response is `Cache-Control: no-store`. BARQ has no established API caching
// semantics today (next.config.ts sets only security headers), and availability
// MUST never be cached stale, so Gate 1 uses no-store uniformly rather than
// inventing risky short-lived/CDN cache behavior. Short-lived public caching for
// the safe read endpoints (services/detail/categories/providers) can be added as
// a deliberate, separately-approved opt-in later — it is intentionally NOT done
// here, and this does not change any global Next/Vercel cache configuration.

/** JSON 200 response with the standard Gate-1 no-store cache header. */
export function apiOk(data: unknown, init?: { status?: number }): NextResponse {
  const response = NextResponse.json(data, { status: init?.status ?? 200 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
