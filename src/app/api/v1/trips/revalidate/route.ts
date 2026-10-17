import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { readJsonObject } from "@/lib/api/v1/request-body";
import { revalidateTripItems } from "@/lib/trips/revalidate-trip-items";

// POST /api/v1/trips/revalidate — Trip planner, grounded foundation (2026-10-17).
//
// READ-ONLY: re-reads current price options, open slots and seats for plan items before the
// customer continues to booking (`{ adults, children, items: [{ serviceId, date, expectedCost }] }`
// → `{ items: [{ serviceId, date, status, availability, currentCost }] }`). Reserves nothing; the
// booking flow re-checks again at submit time.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withRequestTracing("api.v1.trips.revalidate", async () => {
    const locale = resolveApiLocale(request);
    const result = await revalidateTripItems(await readJsonObject(request), locale);
    if (!result.ok) return apiError("INVALID_INPUT", { locale });
    return apiOk({ items: result.items });
  });
}
