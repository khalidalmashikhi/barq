import {
  getServiceById,
  getActivePricesForService,
  getServiceRatingAggregate,
} from "@/lib/services/get-service-detail";
import { getPublicTourVehicleSummary } from "@/lib/tour-template/vehicle-pool/public-tour-vehicles";
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

    const [activePrices, rating, tourVehicleSummary] = await Promise.all([
      // Locale-aware: each active price carries its own already-localized unit label.
      getActivePricesForService(detail.id, locale),
      getServiceRatingAggregate(detail.id),
      // TOUR-VEHICLE-3 — customer-safe tour vehicle summary (null for non-tour / GUIDE_ONLY).
      getPublicTourVehicleSummary(detail.id),
    ]);

    return apiOk(toServiceDetailDTO(detail, activePrices, rating, tourVehicleSummary));
  });
}
