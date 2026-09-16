import { prisma } from "@/lib/db";
import { resolveRentalServiceCalendar } from "@/lib/offerings/rental/resolve-rental-service-calendar";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";

// GET /api/v1/services/{id}/rental-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — Phase 3C Slice C2c.
//
// PUBLIC, READ-ONLY daily-rental calendar for a publicly-visible VEHICLE_RENTAL Service over a strict
// Oman date window. Thin adapter over resolveRentalServiceCalendar (the single authority for public
// visibility + rental-vertical/vehicle eligibility + per-date CONFIGURED availability + authoritative
// daily pricing). No auth (equivalent to the public Service detail/availability endpoints). NO mutation,
// transaction write, audit write, or side effect. DYNAMIC / no-store: availability is mutable and must
// never be cached stale (apiOk sets Cache-Control: no-store).
//
// AVAILABILITY IS "CONFIGURED", NOT reservation-confirmed: there is no daily-rental reservation-conflict
// authority yet, so the response carries availabilityBasis: "CONFIGURED" and is deliberately
// non-actionable. C3/E must revalidate vehicle-reservation conflicts atomically before any booking.
//
// FAIL-CLOSED, non-enumerating: a non-public / unknown / non-rental Service → uniform 404; a bad window
// → 400; a read failure → 500. The body never reveals provider status, vertical compliance, vehicle
// verification, ownership, offering status, or any internal/Prisma detail.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.services.rental-calendar", async () => {
    const { id } = await params;
    const locale = resolveApiLocale(request);
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;

    const result = await resolveRentalServiceCalendar(prisma, { serviceId: id, from, to });
    if (result.ok) return apiOk(result.calendar);

    switch (result.reason) {
      case "INVALID_WINDOW":
        return apiError("INVALID_INPUT", { locale });
      case "NOT_PUBLIC":
        return apiError("NOT_FOUND", { locale });
      // Pathological-data overflow (inspected-candidate ceiling or eligible-offering bound exceeded)
      // and read failures all map to the SAME safe, generic 500 — never revealing fleet/provider
      // state or which limit was hit, and never a partial/misleading calendar.
      case "CANDIDATE_LIMIT_EXCEEDED":
      case "ELIGIBLE_OFFERING_LIMIT_EXCEEDED":
      case "READ_FAILED":
      default:
        return apiError("INTERNAL_ERROR", { locale });
    }
  });
}
