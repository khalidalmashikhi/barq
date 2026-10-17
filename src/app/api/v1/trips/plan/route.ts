import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { readJsonObject } from "@/lib/api/v1/request-body";
import { hmacRateLimitKey, resolveClientIp } from "@/lib/rate-limit/client-ip";
import { generateTripPlan } from "@/lib/trips/generate-trip-plan";

// POST /api/v1/trips/plan — Trip planner, grounded foundation (2026-10-17).
//
// Thin adapter over generateTripPlan() (ADR-0011): body `{ input, regenerateDay?, keepServiceIds?,
// variant? }` → `{ plan }` (or `{ day }` for a single-day regeneration). Public, no sign-in, no
// persistence: nothing is stored, so there is no plan id another customer could read. The requester
// key for the rate limit is an HMAC of the client IP (never the raw IP). Deterministic and grounded:
// every BARQ item comes from published services; nothing is booked or reserved.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withRequestTracing("api.v1.trips.plan", async () => {
    const locale = resolveApiLocale(request);
    const body = await readJsonObject(request);
    const requesterKey = hmacRateLimitKey(resolveClientIp(request.headers), process.env.BETTER_AUTH_SECRET ?? "");
    const result = await generateTripPlan({
      input: body.input,
      locale,
      requesterKey,
      regenerateDay: typeof body.regenerateDay === "number" ? body.regenerateDay : undefined,
      keepServiceIds: Array.isArray(body.keepServiceIds) ? (body.keepServiceIds as unknown[]).filter((v): v is string => typeof v === "string") : undefined,
      variant: typeof body.variant === "number" ? body.variant : undefined,
    });
    if (result.ok) return apiOk("plan" in result ? { plan: result.plan } : { day: result.day });
    if (result.code === "INVALID_INPUT") return apiError("INVALID_INPUT", { locale, details: { fields: result.fields } });
    if (result.code === "RATE_LIMITED") return apiError("RATE_LIMITED", { locale, retryAfterSeconds: result.retryAfterSeconds });
    return apiError("INTERNAL_ERROR", { locale });
  });
}
