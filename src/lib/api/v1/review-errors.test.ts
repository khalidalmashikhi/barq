import { describe, it, expect } from "vitest";
import { toApiReviewErrorCode } from "./review-errors";
import type { ReviewActionErrorCode } from "@/lib/booking/review-action-errors";

// REVIEW-API-1 — the mapper is pure, so it is tested directly rather than only
// through the route. What matters here is that every domain code has a deliberate
// destination and that the two security-relevant ones keep their meaning.

describe("toApiReviewErrorCode", () => {
  it("maps every review domain code to a deliberate API code", () => {
    const expected: Record<ReviewActionErrorCode, string> = {
      INVALID_INPUT: "INVALID_INPUT",
      NO_CUSTOMER_PROFILE: "NO_CUSTOMER_PROFILE",
      BOOKING_NOT_FOUND: "NOT_FOUND",
      BOOKING_NOT_REVIEWABLE: "BOOKING_NOT_REVIEWABLE",
      ALREADY_REVIEWED: "ALREADY_REVIEWED",
      INVALID_RATING: "INVALID_RATING",
      INVALID_CONTENT: "INVALID_CONTENT",
      RATE_LIMITED: "RATE_LIMITED",
      UNKNOWN_ERROR: "INTERNAL_ERROR",
    };

    for (const [domain, api] of Object.entries(expected)) {
      expect(toApiReviewErrorCode(domain as ReviewActionErrorCode)).toBe(api);
    }
  });

  // createReview() returns this ONE code for a booking that does not exist and for
  // one belonging to another customer. Mapping it to a review-specific code would
  // hand a caller the distinction the domain deliberately withholds.
  it("collapses BOOKING_NOT_FOUND to the generic NOT_FOUND, preserving anti-enumeration", () => {
    expect(toApiReviewErrorCode("BOOKING_NOT_FOUND")).toBe("NOT_FOUND");
  });

  // The domain's catch-all is already logged server-side; it must never reach a
  // client as a normal rejection.
  it("maps the unexpected catch-all to INTERNAL_ERROR", () => {
    expect(toApiReviewErrorCode("UNKNOWN_ERROR")).toBe("INTERNAL_ERROR");
  });

  it("falls back to INTERNAL_ERROR for a code it has never heard of", () => {
    expect(toApiReviewErrorCode("SOMETHING_NEW" as ReviewActionErrorCode)).toBe("INTERNAL_ERROR");
  });
});
