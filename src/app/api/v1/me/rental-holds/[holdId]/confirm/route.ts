import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { rentalHoldErrorResponse } from "@/lib/api/v1/rental-hold-errors";
import { confirmRentalHoldForCustomer, parseExpectedQuoteInput } from "@/lib/offerings/rental/booking/customer-rental-hold-actions";

// Phase 3C Slice C3/E2 — POST /api/v1/me/rental-holds/{holdId}/confirm. Authenticated OWNER confirms
// a live hold → creates ONE Booking + transitions every date HELD→CONFIRMED atomically. Requires a
// (separate) confirmation idempotency key AND an expected quote (fingerprint/total+currency). NO
// payment. On price drift returns 409 PRICE_CHANGED with the fresh quote in details.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ holdId: string }> }) {
  return withRequestTracing("api.v1.me.rental-holds.confirm", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { holdId } = await params;
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return apiError("INVALID_INPUT", { locale });

      const idempotencyKey =
        request.headers.get("Idempotency-Key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);

      const result = await confirmRentalHoldForCustomer({
        holdId,
        idempotencyKey,
        expectedQuote: parseExpectedQuoteInput(body.expectedQuote),
      });
      if (!result.ok) return rentalHoldErrorResponse(result.error, locale, { quote: result.quote });

      // The rental snapshot is already customer-safe; expose it under `rental` alongside id/status.
      return apiOk(
        { booking: { id: result.booking.id, status: result.booking.status, rental: result.booking.rentalSnapshot } },
        { status: result.replayed ? 200 : 201 },
      );
    }),
  );
}
