import { describe, it, expect } from "vitest";
import {
  isEmailEligibleKind,
  bookingEmailAudience,
  EMAIL_ELIGIBLE_KINDS,
} from "./booking-email-policy";

// BOOKING NOTIFICATION DELIVERY — pins the approved email policy: exactly the six (kind→audience)
// pairs, and NOTHING else (self-receipts, review, and the provider side of expiry stay in-app).

describe("booking email policy", () => {
  it("email-eligible kinds are EXACTLY the approved set", () => {
    expect([...EMAIL_ELIGIBLE_KINDS].sort()).toEqual(
      [
        "BOOKING_ACCEPTED",
        "BOOKING_CANCELLED",
        "BOOKING_CANCELLED_BY_CUSTOMER",
        "BOOKING_COMPLETED",
        "BOOKING_EXPIRED",
        "BOOKING_REJECTED",
        "BOOKING_STARTED",
        "PENDING_PROVIDER",
      ].sort(),
    );
  });

  it("maps each eligible kind to the correct audience", () => {
    expect(bookingEmailAudience("PENDING_PROVIDER")).toBe("PROVIDER");
    expect(bookingEmailAudience("BOOKING_ACCEPTED")).toBe("CUSTOMER");
    expect(bookingEmailAudience("BOOKING_REJECTED")).toBe("CUSTOMER");
    expect(bookingEmailAudience("BOOKING_CANCELLED")).toBe("CUSTOMER");
    expect(bookingEmailAudience("BOOKING_CANCELLED_BY_CUSTOMER")).toBe("PROVIDER");
    expect(bookingEmailAudience("BOOKING_EXPIRED")).toBe("CUSTOMER");
    // COMPLETION & REVIEW LOOP — both customer-addressed.
    expect(bookingEmailAudience("BOOKING_STARTED")).toBe("CUSTOMER");
    expect(bookingEmailAudience("BOOKING_COMPLETED")).toBe("CUSTOMER");
  });

  it("self-receipts, review, and unknown kinds are NOT email-eligible", () => {
    for (const kind of ["PROVIDER_BOOKING_CONFIRMED", "PROVIDER_BOOKING_REJECTED", "NEW_REVIEW_RECEIVED"] as const) {
      expect(isEmailEligibleKind(kind)).toBe(false);
      expect(bookingEmailAudience(kind)).toBeNull();
    }
  });
});
