import { describe, it, expect } from "vitest";
import { toApiBookingErrorCode, bookingErrorResponse } from "./booking-errors";

describe("toApiBookingErrorCode", () => {
  it("maps customer-reachable domain codes 1:1 to API codes", () => {
    expect(toApiBookingErrorCode("INVALID_INPUT")).toBe("INVALID_INPUT");
    expect(toApiBookingErrorCode("NO_CUSTOMER_PROFILE")).toBe("NO_CUSTOMER_PROFILE");
    // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — customer-reachable and ACTIONABLE, so it
    // maps 1:1 rather than collapsing into INTERNAL_ERROR. A native client reads this
    // code to know the booking was refused for a reason the customer can resolve.
    expect(toApiBookingErrorCode("CUSTOMER_INCOMPLETE")).toBe("CUSTOMER_INCOMPLETE");
    expect(toApiBookingErrorCode("SERVICE_UNAVAILABLE")).toBe("SERVICE_UNAVAILABLE");
    expect(toApiBookingErrorCode("PRICE_UNAVAILABLE")).toBe("PRICE_UNAVAILABLE");
    // BOOKING-SLOT-AUTHORITY — three DISTINCT slot codes. Collapsing any pair would
    // tell a customer the wrong thing: "pick a time" vs "that time is gone" vs "it
    // just sold out" are different instructions.
    expect(toApiBookingErrorCode("SLOT_REQUIRED")).toBe("SLOT_REQUIRED");
    expect(toApiBookingErrorCode("SLOT_UNAVAILABLE")).toBe("SLOT_UNAVAILABLE");
    expect(toApiBookingErrorCode("SLOT_FULL")).toBe("SLOT_FULL");
    expect(toApiBookingErrorCode("DUPLICATE_BOOKING")).toBe("DUPLICATE_BOOKING");
    expect(toApiBookingErrorCode("BOOKING_NOT_FOUND")).toBe("NOT_FOUND");
    expect(toApiBookingErrorCode("BOOKING_NOT_CANCELLABLE")).toBe("BOOKING_NOT_CANCELLABLE");
    expect(toApiBookingErrorCode("RATE_LIMITED")).toBe("RATE_LIMITED");
  });

  it("maps provider-only + UNKNOWN codes to INTERNAL_ERROR (never a normal rejection)", () => {
    expect(toApiBookingErrorCode("UNKNOWN_ERROR")).toBe("INTERNAL_ERROR");
    expect(toApiBookingErrorCode("NO_PROVIDER_PROFILE")).toBe("INTERNAL_ERROR");
    expect(toApiBookingErrorCode("BOOKING_NOT_PENDING")).toBe("INTERNAL_ERROR");
    expect(toApiBookingErrorCode("BOOKING_NOT_STARTABLE")).toBe("INTERNAL_ERROR");
    expect(toApiBookingErrorCode("BOOKING_NOT_COMPLETABLE")).toBe("INTERNAL_ERROR");
  });
});

describe("bookingErrorResponse", () => {
  it("maps each code to the correct HTTP status (400/403/404/409/422/429/500) with no-store", () => {
    expect(bookingErrorResponse("INVALID_INPUT", "en").status).toBe(400);
    expect(bookingErrorResponse("NO_CUSTOMER_PROFILE", "en").status).toBe(403);
    expect(bookingErrorResponse("BOOKING_NOT_FOUND", "en").status).toBe(404);
    expect(bookingErrorResponse("SLOT_FULL", "en").status).toBe(409);
    expect(bookingErrorResponse("SERVICE_UNAVAILABLE", "en").status).toBe(422);
    expect(bookingErrorResponse("PRICE_UNAVAILABLE", "en").status).toBe(422);
    expect(bookingErrorResponse("SLOT_REQUIRED", "en").status).toBe(422);
    expect(bookingErrorResponse("SLOT_UNAVAILABLE", "en").status).toBe(422);
    expect(bookingErrorResponse("DUPLICATE_BOOKING", "en").status).toBe(422);
    expect(bookingErrorResponse("BOOKING_NOT_CANCELLABLE", "en").status).toBe(422);
    expect(bookingErrorResponse("RATE_LIMITED", "en").status).toBe(429);
    expect(bookingErrorResponse("UNKNOWN_ERROR", "en").status).toBe(500);
    expect(bookingErrorResponse("SLOT_FULL", "en").headers.get("cache-control")).toBe("no-store");
  });

  it("emits the stable machine code and a localized message; never a raw exception", async () => {
    const en = await bookingErrorResponse("SLOT_FULL", "en").json();
    expect(en).toEqual({
      error: { code: "SLOT_FULL", message: "Sorry, the remaining capacity for this slot was just taken." },
    });
    const ar = await bookingErrorResponse("SLOT_FULL", "ar").json();
    expect(ar.error.code).toBe("SLOT_FULL");
    expect(ar.error.message).toContain("السعة");
  });
});
