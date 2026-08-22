import { createReview } from "@/lib/booking/create-review";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { reviewErrorResponse } from "@/lib/api/v1/review-errors";

// POST /api/v1/me/bookings/{id}/review — REVIEW-API-1.
//
// Thin adapter over the authoritative createReview(), which already: requires an
// authenticated Customer, re-verifies OWNERSHIP from the DB (a booking owned by
// another customer returns BOOKING_NOT_FOUND -> 404, identical to a nonexistent
// one, so it is never enumerable), enforces COMPLETED-only eligibility via
// canReviewBooking(), validates the rating as an integer 1-5 and the content as
// non-blank after trimming and at most 2000 characters, applies the per-customer
// review-create rate limit, derives providerId from the fetched Booking, and
// relies on Review.bookingId's @unique constraint (P2002 -> ALREADY_REVIEWED) as
// the race-safe duplicate backstop rather than on its own pre-check alone.
//
// NO BUSINESS RULE IS REIMPLEMENTED HERE. Exactly like POST /api/v1/me/bookings
// does for createBooking(), this route only adapts the transport: it parses JSON
// and hands createReview() the FormData shape it already consumes on the web, so
// the web Server Action and this route run the SAME code path and cannot drift.
// Every value below is re-validated inside createReview() regardless of what is
// forwarded, which is why forwarding a deliberately-invalid placeholder for a
// missing field is safe: the domain rejects it with the right code.
//
// NOTHING AUTHORITATIVE IS ACCEPTED FROM THE CLIENT. There is no customerId,
// providerId, serviceId, status, hasReview or moderationState in this contract —
// createReview() reads provider/service linkage off the Booking row it fetched,
// so forging one is structurally impossible rather than merely rejected.
//
// NOT IDEMPOTENT, deliberately. A second POST for the same booking is refused
// with 409 ALREADY_REVIEWED, never a silent 200 — see review-errors.ts for why
// that code is what makes a lost-response retry recoverable. Private/no-store.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.bookings.review.create", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { id } = await params;

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return apiError("INVALID_INPUT", { locale });

      // Build the exact FormData shape createReview() already consumes on the web —
      // an input-adapter only, NOT a reimplementation.
      //
      // `rating` is stringified rather than pre-validated so the ONE authority stays
      // the domain's own `Number.isInteger(v) && 1 <= v <= 5` check: 2.5 becomes
      // "2.5" and is rejected as non-integer, true becomes "true" and is rejected as
      // NaN, and an absent value becomes "" and is rejected the same way. A guard
      // here would be a second, drifting copy of that rule.
      const form = new FormData();
      form.set("rating", body.rating === undefined || body.rating === null ? "" : String(body.rating));
      form.set("content", typeof body.content === "string" ? body.content : "");

      const result = await createReview(id, form);
      if (!result.ok) return reviewErrorResponse(result.error, locale);

      return apiOk({ ok: true });
    })
  );
}
