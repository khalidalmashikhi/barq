// Phase 3C Slice C2b-R — the stable, locale-neutral error vocabulary for rental-offering
// provider write management. Mirrors the existing provider-domain convention: a discriminated
// { ok: true; ... } | { ok: false; error: RentalOfferingErrorCode } result; codes are stable
// strings mapped to i18n at the edge; raw Prisma errors and foreign-resource existence are
// NEVER leaked (a foreign Service/Vehicle/Offering resolves to a uniform *_NOT_FOUND).

export type RentalOfferingErrorCode =
  // Auth / ownership (UnauthenticatedError is thrown, not returned — the caller/adapter maps it).
  | "PROVIDER_NOT_APPROVED"
  | "NO_PROVIDER_PROFILE"
  | "SERVICE_NOT_FOUND" // missing OR not owned by the session provider (uniform, non-enumerating)
  | "VEHICLE_NOT_FOUND" // missing OR not owned OR not a VEHICLE asset (uniform)
  | "OFFERING_NOT_FOUND" // missing OR not owned (uniform)
  | "WRONG_SERVICE_KIND" // the Service's authoritative offeringKind is not VEHICLE_RENTAL
  // Vertical authorization / compliance.
  | "VERTICAL_NOT_AUTHORIZED" // no requested vertical, rejected, suspended, or not APPROVED
  | "VERTICAL_NOT_COMPLIANT" // APPROVED but documents incomplete / policy not configured
  // Vehicle readiness (publish / live edit of a PUBLISHED offering).
  | "VEHICLE_NOT_SELECTABLE" // not ACTIVE / not APPROVED / required docs missing-notapproved-expired
  | "VERIFIED_CAPACITY_MISSING" // no verified bookablePassengerCapacity
  // Money / currency / capacity.
  | "INVALID_MONEY" // malformed / zero / negative base or override amount
  | "INVALID_CURRENCY" // empty / malformed currency
  | "CURRENCY_LOCKED" // currency may change only while DRAFT
  | "CURRENCY_OVERRIDES_PRESENT" // day price overrides must be cleared before a currency change
  | "INVALID_CAPACITY_OVERRIDE" // not a positive integer, or greater than verified capacity
  // Identity / lifecycle.
  | "OFFERING_ALREADY_ACTIVE" // partial-unique conflict: a non-ARCHIVED offering already exists for (service, vehicle)
  | "OFFERING_STATE_CONFLICT" // disallowed lifecycle transition, or a concurrent transition lost the guard
  | "OFFERING_ARCHIVED" // ARCHIVED is terminal/immutable
  | "NO_PUBLISHABLE_DAY" // publish requires >= 1 explicit OPEN non-past day with a resolvable price
  // Days / start times.
  | "INVALID_DATE" // malformed OR past Oman date
  | "DATE_WINDOW_TOO_LARGE" // bulk-open window exceeds the maximum inclusive days
  | "OFFERING_DAY_NOT_FOUND" // an override/start-time target day row does not exist (never auto-created)
  | "INVALID_START_TIME" // out-of-range / non-integer / duplicate minutes, or too many per request
  // Fallbacks.
  | "INVALID_INPUT"
  | "UNKNOWN_ERROR";

export type RentalOfferingResult<T> = { ok: true; value: T } | { ok: false; error: RentalOfferingErrorCode };
