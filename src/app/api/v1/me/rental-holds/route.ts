import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { rentalHoldErrorResponse } from "@/lib/api/v1/rental-hold-errors";
import { acquireRentalHoldForCustomer, parseExpectedQuoteInput } from "@/lib/offerings/rental/booking/customer-rental-hold-actions";

// Phase 3C Slice C3/E2 — POST /api/v1/me/rental-holds. Authenticated customer acquires a temporary
// daily-rental hold. Thin adapter: parses JSON, requires an idempotency key (header or body), and
// delegates ALL business logic + auth + rate-limit to the domain action. No-store via apiOk/apiError.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.rental-holds.acquire", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return apiError("INVALID_INPUT", { locale });

      const idempotencyKey =
        request.headers.get("Idempotency-Key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);

      const result = await acquireRentalHoldForCustomer({
        offeringId: body.offeringId,
        dateKeys: body.dateKeys,
        passengerCount: body.passengerCount,
        idempotencyKey,
        expectedQuote: parseExpectedQuoteInput(body.expectedQuote),
      });
      if (!result.ok) return rentalHoldErrorResponse(result.error, locale, { quote: result.quote });
      // A fresh hold is a 201; an idempotent replay of an existing hold is a 200.
      return apiOk({ hold: result.hold }, { status: result.hold.replayed ? 200 : 201 });
    }),
  );
}
