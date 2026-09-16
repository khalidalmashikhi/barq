import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { rentalHoldErrorResponse } from "@/lib/api/v1/rental-hold-errors";
import { releaseRentalHoldForCustomer } from "@/lib/offerings/rental/booking/customer-rental-hold-actions";

// Phase 3C Slice C3/E2 — DELETE /api/v1/me/rental-holds/{holdId}. Authenticated OWNER releases a
// temporary hold (only live HELD children → RELEASED; idempotent; never another customer's hold;
// CONFIRMED reservations are never released through this endpoint). Idempotency key via header/body.
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ holdId: string }> }) {
  return withRequestTracing("api.v1.me.rental-holds.release", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { holdId } = await params;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const idempotencyKey =
        request.headers.get("Idempotency-Key") ?? (body && typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);

      const result = await releaseRentalHoldForCustomer({ holdId, idempotencyKey });
      if (!result.ok) return rentalHoldErrorResponse(result.error, locale);
      return apiOk({ released: result.releasedCount });
    }),
  );
}
