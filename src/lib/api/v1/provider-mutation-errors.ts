import type { NextResponse } from "next/server";
import type { Locale } from "@/i18n/locales";
import type { ServiceActionErrorCode } from "@/lib/provider/service-action-errors";
import type { AvailabilityActionErrorCode } from "@/lib/provider/availability-action-errors";
import type { ProviderProfileActionErrorCode } from "@/lib/provider/provider-profile-errors";
import type { BookingActionErrorCode } from "@/lib/booking/booking-action-errors";
import type { VehicleActionErrorCode } from "@/lib/vehicles/vehicle-errors";
import type { TourVehiclePoolErrorCode } from "@/lib/tour-template/vehicle-pool/pool-errors";
import { apiError, type ApiErrorCode } from "./errors";

// Gate PC (Provider Mutation API) — maps the EXISTING authoritative provider
// domain error codes onto the API v1 error envelope. Like booking-errors.ts
// (Gate 3), this ONLY translates a stable domain code to HTTP + wire shape; it
// never changes a domain meaning and never surfaces a raw exception string.
//
// OWNERSHIP IS UNIFORM-404 (anti-enumeration): every "not found / not owned"
// domain code (SERVICE_NOT_FOUND, SLOT_NOT_FOUND, BOOKING_NOT_FOUND) maps to a
// single NOT_FOUND — a provider can never tell "doesn't exist" from "belongs to
// someone else". The domain readers/actions already scope by the caller's own
// provider.id, so this mapping just carries that guarantee to the wire.
//
// The auth-gate outcomes (NO_PROVIDER_PROFILE / PROVIDER_NOT_APPROVED) are
// normally intercepted by withApiV1ProviderMutation's pre-auth, but the actions
// can also return them as result codes (e.g. an APPLIED provider hitting an
// approved-only action), so they are mapped here too, 1:1, for completeness.

const SERVICE_CODE_MAP: Record<ServiceActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  PROVIDER_NOT_APPROVED: "PROVIDER_NOT_APPROVED",
  SERVICE_NOT_FOUND: "NOT_FOUND",
  // Both publish blockers (BR-026 category + active price) surface as a single
  // "not publishable yet"; the specific blockers ride along in details.blockers.
  NO_ACTIVE_PRICE: "SERVICE_NOT_PUBLISHABLE",
  SERVICE_CATEGORY_REQUIRED: "SERVICE_NOT_PUBLISHABLE",
  INVALID_CATEGORY: "INVALID_CATEGORY",
  // Gate B5 — provider not authorized for the (otherwise valid) category → 403.
  ACTIVITY_NOT_AUTHORIZED: "ACTIVITY_NOT_AUTHORIZED",
  // TOUR-1 — smart tour-guide template outcomes.
  TOUR_TEMPLATE_NOT_ELIGIBLE: "TOUR_TEMPLATE_NOT_ELIGIBLE",
  TOUR_TEMPLATE_INVALID: "TOUR_TEMPLATE_INVALID",
  // Publish-time completeness (eligible tour missing content) → "not publishable
  // yet", consistent with the other publish blockers.
  TOUR_TEMPLATE_REQUIRED: "SERVICE_NOT_PUBLISHABLE",
  // TOUR-VEHICLE-2P — transport tour with no eligible pooled vehicle → "not publishable
  // yet"; the specific blocker rides in details.blockers (same as the other publish gates).
  TOUR_VEHICLE_POOL_REQUIRED: "SERVICE_NOT_PUBLISHABLE",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

const AVAILABILITY_CODE_MAP: Record<AvailabilityActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  PROVIDER_NOT_APPROVED: "PROVIDER_NOT_APPROVED",
  SERVICE_NOT_FOUND: "NOT_FOUND",
  SLOT_NOT_FOUND: "NOT_FOUND",
  CAPACITY_BELOW_BOOKED: "CAPACITY_BELOW_BOOKED",
  SLOT_HAS_BOOKINGS: "SLOT_HAS_BOOKINGS",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

const PROFILE_CODE_MAP: Record<ProviderProfileActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

// Provider-context booking actions (accept/reject/start/complete) all gate on
// requireProvider() and return only this subset. The lifecycle-state mismatches
// (NOT_PENDING/STARTABLE/COMPLETABLE) collapse to one 409 BOOKING_NOT_ACTIONABLE
// — the client re-reads the booking to see its actual status. Codes that are only
// reachable from the CUSTOMER create/cancel flow (never these endpoints) map to
// INTERNAL_ERROR, matching booking-errors.ts's "unexpected condition" discipline.
const BOOKING_ACTION_CODE_MAP: Record<BookingActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  BOOKING_NOT_FOUND: "NOT_FOUND",
  BOOKING_NOT_PENDING: "BOOKING_NOT_ACTIONABLE",
  BOOKING_NOT_STARTABLE: "BOOKING_NOT_ACTIONABLE",
  BOOKING_NOT_COMPLETABLE: "BOOKING_NOT_ACTIONABLE",
  // BOOKING-VEHICLE-1 — provider acceptance vehicle-assignment outcomes (422 unprocessable),
  // except the concurrent race which is the existing 409 CONCURRENT_MODIFICATION.
  VEHICLE_REQUIRED: "VEHICLE_REQUIRED",
  VEHICLE_NOT_IN_SERVICE_POOL: "VEHICLE_NOT_IN_SERVICE_POOL",
  VEHICLE_NOT_ELIGIBLE: "TOUR_VEHICLE_NOT_ELIGIBLE",
  VEHICLE_CAPACITY_INSUFFICIENT: "VEHICLE_CAPACITY_INSUFFICIENT",
  BOOKING_STATE_CONFLICT: "CONCURRENT_MODIFICATION",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
  // Not reachable from provider accept/reject/start/complete — treated as
  // unexpected internal conditions rather than normal rejections.
  NO_CUSTOMER_PROFILE: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "INTERNAL_ERROR",
  PRICE_UNAVAILABLE: "INTERNAL_ERROR",
  SLOT_UNAVAILABLE: "INTERNAL_ERROR",
  SLOT_FULL: "INTERNAL_ERROR",
  DUPLICATE_BOOKING: "INTERNAL_ERROR",
  BOOKING_NOT_CANCELLABLE: "INTERNAL_ERROR",
  RATE_LIMITED: "INTERNAL_ERROR",
};

// VEHICLE-1B — provider vehicle mutation codes. Ownership is uniform-404
// (VEHICLE_NOT_FOUND -> NOT_FOUND) exactly like services/availability, so a
// provider can never tell "doesn't exist" from "belongs to someone else". A
// duplicate registration maps to a dedicated 409 (never reveals the owner).
const VEHICLE_CODE_MAP: Record<VehicleActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  PROVIDER_NOT_APPROVED: "PROVIDER_NOT_APPROVED",
  DUPLICATE_REGISTRATION: "DUPLICATE_REGISTRATION",
  VEHICLE_NOT_FOUND: "NOT_FOUND",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

// TOUR-VEHICLE-2 — vehicle-pool mutation codes. Ownership stays uniform-404
// (SERVICE_NOT_FOUND / VEHICLE_NOT_FOUND → NOT_FOUND) so a provider can never tell
// "doesn't exist" from "belongs to someone else". Not-eligible outcomes are 422.
const TOUR_VEHICLE_POOL_CODE_MAP: Record<TourVehiclePoolErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  PROVIDER_NOT_APPROVED: "PROVIDER_NOT_APPROVED",
  SERVICE_NOT_FOUND: "NOT_FOUND",
  VEHICLE_NOT_FOUND: "NOT_FOUND",
  TOUR_SERVICE_NOT_ELIGIBLE: "TOUR_SERVICE_NOT_ELIGIBLE",
  VEHICLE_NOT_ELIGIBLE: "TOUR_VEHICLE_NOT_ELIGIBLE",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

/** Build the API v1 error response for a provider vehicle-action code. */
export function vehicleErrorResponse(code: VehicleActionErrorCode, locale: Locale): NextResponse {
  return apiError(VEHICLE_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale });
}

/** Build the API v1 error response for a tour vehicle-pool action code. */
export function tourVehiclePoolErrorResponse(code: TourVehiclePoolErrorCode, locale: Locale): NextResponse {
  return apiError(TOUR_VEHICLE_POOL_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale });
}

/** Build the API v1 error response for a provider service-action code. */
export function serviceErrorResponse(
  code: ServiceActionErrorCode,
  locale: Locale,
  details?: Record<string, unknown>
): NextResponse {
  return apiError(SERVICE_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale, details });
}

/** Build the API v1 error response for a provider availability-action code. */
export function availabilityErrorResponse(code: AvailabilityActionErrorCode, locale: Locale): NextResponse {
  return apiError(AVAILABILITY_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale });
}

/** Build the API v1 error response for a provider profile-action code. */
export function providerProfileErrorResponse(code: ProviderProfileActionErrorCode, locale: Locale): NextResponse {
  return apiError(PROFILE_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale });
}

/** Build the API v1 error response for a provider-context booking-action code. */
export function providerBookingErrorResponse(code: BookingActionErrorCode, locale: Locale): NextResponse {
  return apiError(BOOKING_ACTION_CODE_MAP[code] ?? "INTERNAL_ERROR", { locale });
}
