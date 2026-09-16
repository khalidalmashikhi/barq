import type { NextResponse } from "next/server";
import type { Locale } from "@/i18n/locales";
import { apiError, type ApiErrorCode } from "./errors";
import type { RentalHoldErrorCode } from "@/lib/offerings/rental/booking/customer-rental-hold-actions";
import type { RentalHoldQuote } from "@/lib/offerings/rental/reservation/reservation-types";

// Phase 3C Slice C3/E2 — map the daily-rental hold/confirm domain codes to the stable public API
// envelope. Non-enumerating: NOT_BOOKABLE (ineligible/non-public offering) and a foreign/missing hold
// both collapse to a plain 404, never revealing provider status / vertical compliance / vehicle
// verification / another customer / private reservation detail. PRICE_CHANGED carries only the fresh
// SAFE quote in `details` so the client can re-accept.

const CODE_MAP: Record<RentalHoldErrorCode, ApiErrorCode> = {
  UNAUTHENTICATED: "UNAUTHORIZED",
  NO_CUSTOMER: "NO_CUSTOMER_PROFILE",
  IDEMPOTENCY_KEY_INVALID: "IDEMPOTENCY_KEY_INVALID",
  IDEMPOTENCY_MISMATCH: "IDEMPOTENCY_KEY_CONFLICT",
  INVALID_INPUT: "INVALID_INPUT",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_BOOKABLE: "NOT_FOUND",
  DAY_NOT_AVAILABLE: "SLOT_UNAVAILABLE",
  CAPACITY_EXCEEDED: "BOOKING_QUANTITY_OUT_OF_RANGE",
  PRICE_CHANGED: "PRICE_CHANGED",
  VEHICLE_DATE_CONFLICT: "VEHICLE_BUSY",
  HOLD_NOT_FOUND: "NOT_FOUND",
  HOLD_EXPIRED: "HOLD_EXPIRED",
  HOLD_NOT_CONFIRMABLE: "HOLD_NOT_CONFIRMABLE",
  READ_FAILED: "INTERNAL_ERROR",
};

/** The customer-safe projection of an authoritative quote (for a PRICE_CHANGED payload). */
export function safeQuoteDetails(quote: RentalHoldQuote): Record<string, unknown> {
  return {
    offeringId: quote.offeringId,
    vehicleId: quote.vehicleId,
    serviceId: quote.serviceId,
    dateKeys: quote.dateKeys,
    perDate: quote.days.map((d) => ({ dateKey: d.dateKey, amount: d.amount, currency: d.currency, source: d.priceSource })),
    chargeableDays: quote.chargeableDays,
    total: quote.total,
    currency: quote.currency,
    quoteFingerprint: quote.quoteFingerprint,
  };
}

export function rentalHoldErrorResponse(error: RentalHoldErrorCode, locale: Locale, options?: { quote?: RentalHoldQuote }): NextResponse {
  const code = CODE_MAP[error];
  if (error === "PRICE_CHANGED" && options?.quote) {
    return apiError(code, { locale, details: { quote: safeQuoteDetails(options.quote) } });
  }
  return apiError(code, { locale });
}
