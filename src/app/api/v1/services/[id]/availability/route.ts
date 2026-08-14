import { getServiceById } from "@/lib/services/get-service-detail";
import { getAvailableSlots } from "@/lib/booking/get-available-slots";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toAvailabilitySlotDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/services/{id}/availability — Gate 1 (Public API Foundation).
//
// DYNAMIC / NO-STORE: capacity changes on every booking, so availability must
// never be cached stale (apiOk already sets Cache-Control: no-store).
//
// VISIBILITY GATE PRESERVED: the service is first resolved through
// getServiceById() (PUBLISHED + provider APPROVED/visible) — mirroring the web
// booking page, which only reads slots after that gate passes — so availability
// for a non-public/unpublished service is never exposed. getAvailableSlots()
// then returns only OPEN, future, non-full slots. Public, no auth.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.services.availability", async () => {
    const { id } = await params;
    const locale = resolveApiLocale(request);

    const service = await getServiceById(id, locale);
    if (!service) return apiError("NOT_FOUND", { locale });

    const slots = await getAvailableSlots(service.id);

    return apiOk({ items: slots.map(toAvailabilitySlotDTO) });
  });
}
