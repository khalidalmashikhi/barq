import type { NextResponse } from "next/server";
import type { BookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import type { Locale } from "@/i18n/locales";
import { apiError, type ApiErrorCode } from "./errors";

// Gate 3 (Booking Mutations) — maps the EXISTING authoritative
// BookingActionErrorCode (returned by createBooking()/cancelBooking()) onto the
// API v1 error envelope. This ONLY translates a stable code to HTTP + wire shape;
// it never changes a domain meaning and never surfaces a raw exception string.
//
// The customer-reachable codes from createBooking()/cancelBooking() map 1:1 to a
// dedicated API code + status (400/403/404/409/422/429). Provider-only codes
// (NO_PROVIDER_PROFILE, BOOKING_NOT_PENDING/STARTABLE/COMPLETABLE) cannot occur
// on these customer endpoints; if one ever did it would be a genuinely
// unexpected internal condition, so it maps to INTERNAL_ERROR (500) rather than
// being misreported as a normal rejection. UNKNOWN_ERROR (the domain's own
// "unexpected, already logged server-side" catch-all) also maps to 500.

const CODE_MAP: Record<BookingActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_CUSTOMER_PROFILE: "NO_CUSTOMER_PROFILE",
  CUSTOMER_INCOMPLETE: "CUSTOMER_INCOMPLETE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  PRICE_UNAVAILABLE: "PRICE_UNAVAILABLE",
  BOOKING_QUANTITY_OUT_OF_RANGE: "BOOKING_QUANTITY_OUT_OF_RANGE",
  PRICING_UNIT_NOT_BOOKABLE: "PRICING_UNIT_NOT_BOOKABLE",
  SLOT_REQUIRED: "SLOT_REQUIRED",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  SLOT_FULL: "SLOT_FULL",
  DUPLICATE_BOOKING: "DUPLICATE_BOOKING",
  BOOKING_NOT_FOUND: "NOT_FOUND",
  BOOKING_NOT_CANCELLABLE: "BOOKING_NOT_CANCELLABLE",
  // BOOKING-IDEMPOTENCY — reachable from POST /api/v1/me/bookings (a malformed Idempotency-Key,
  // or the same key reused for a different booking request). A same-key same-request retry never
  // reaches here — it returns the original booking as a normal success.
  IDEMPOTENCY_KEY_INVALID: "IDEMPOTENCY_KEY_INVALID",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  // Not reachable from the customer create/cancel endpoints — treated as
  // unexpected internal conditions rather than normal rejections.
  NO_PROVIDER_PROFILE: "INTERNAL_ERROR",
  BOOKING_NOT_PENDING: "INTERNAL_ERROR",
  BOOKING_NOT_STARTABLE: "INTERNAL_ERROR",
  BOOKING_NOT_COMPLETABLE: "INTERNAL_ERROR",
  // A provider-only editing outcome — never reachable from the customer create/cancel endpoints
  // this map serves, so it maps to INTERNAL_ERROR like its sibling provider-state codes.
  BOOKING_NOT_EDITABLE: "INTERNAL_ERROR",
  // BOOKING-VEHICLE-1 — provider-acceptance-only outcomes; never reachable from the
  // customer create/cancel endpoints, so any occurrence here is an unexpected internal.
  VEHICLE_REQUIRED: "INTERNAL_ERROR",
  VEHICLE_NOT_IN_SERVICE_POOL: "INTERNAL_ERROR",
  VEHICLE_NOT_ELIGIBLE: "INTERNAL_ERROR",
  VEHICLE_CAPACITY_INSUFFICIENT: "INTERNAL_ERROR",
  BOOKING_STATE_CONFLICT: "INTERNAL_ERROR",
  // BOOKING-CONFLICT-1B — provider-acceptance-only; never from customer create/cancel.
  VEHICLE_BUSY: "INTERNAL_ERROR",
  // BOOKING-INTERVAL-1 — provider-acceptance-only; never from customer create/cancel.
  SCHEDULE_REQUIRED: "INTERNAL_ERROR",
  INVALID_SCHEDULE: "INTERNAL_ERROR",
  // Provider accept/complete-only; never from customer create/cancel.
  BOOKING_PRICING_INVALID: "INTERNAL_ERROR",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

/** Resolve the API v1 error code for a domain BookingActionErrorCode. */
export function toApiBookingErrorCode(code: BookingActionErrorCode): ApiErrorCode {
  return CODE_MAP[code] ?? "INTERNAL_ERROR";
}

/** Build the API v1 error response for a domain BookingActionErrorCode. */
export function bookingErrorResponse(code: BookingActionErrorCode, locale: Locale): NextResponse {
  return apiError(toApiBookingErrorCode(code), { locale });
}
