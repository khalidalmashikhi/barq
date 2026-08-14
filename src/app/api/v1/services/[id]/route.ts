import {
  getServiceById,
  getActivePricesForService,
  getServiceRatingAggregate,
} from "@/lib/services/get-service-detail";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toServiceDetailDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/services/{id} — Gate 1 (Public API Foundation).
//
// Thin adapter over getServiceById() (which enforces PUBLISHED + provider
// APPROVED/visible and validates the id — returning null for invalid/unavailable
// ⇒ uniform 404). activePrices + rating aggregate reuse the existing readers.
// Public, no auth.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.services.detail", async () => {
    const { id } = await params;
    const locale = resolveApiLocale(request);

    const detail = await getServiceById(id, locale);
    if (!detail) return apiError("NOT_FOUND", { locale });

    const [activePrices, rating] = await Promise.all([
      getActivePricesForService(detail.id),
      getServiceRatingAggregate(detail.id),
    ]);

    return apiOk(toServiceDetailDTO(detail, activePrices, rating));
  });
}
