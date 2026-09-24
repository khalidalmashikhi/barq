import type { RentalOfferingErrorCode } from "../rental-offering-errors";

// Phase 3C Slice C2d-R1 Checkpoint B — the typed, centralized mapping between the C2b-R domain
// result/error vocabulary and provider-safe, LOCALIZED UI message keys. The exact domain code is
// preserved internally on every result; the UI resolves the key via next-intl. No raw Prisma/DB
// error, stack trace, or foreign-resource existence ever reaches the client (SERVICE/VEHICLE/OFFERING
// _NOT_FOUND all collapse to one non-enumerating "no longer available" message). English strings are
// NEVER used as control flow — only codes are.

/** Adapter-level codes on top of the domain vocabulary. */
export type RentalActionCode = RentalOfferingErrorCode | "UNAUTHENTICATED" | "INVALID_INPUT";

/** The small, stable result every rental server action returns (never throws to the client). */
export type RentalActionResult =
  | { ok: true }
  | { ok: false; code: RentalActionCode };

/** Create returns the new offering id so the client can navigate to its workspace. */
export type RentalCreateActionResult =
  | { ok: true; offeringId: string }
  | { ok: false; code: RentalActionCode };

// Domain/adapter code → provider-namespace message key. Every RentalActionCode is covered; several
// map to the shared readiness-blocker keys already used by the list/detail readiness warnings.
const MESSAGE_KEY: Record<RentalActionCode, string> = {
  UNAUTHENTICATED: "rentalErrorUnauthenticated",
  PROVIDER_NOT_APPROVED: "rentalBlockerProviderNotApproved",
  NO_PROVIDER_PROFILE: "rentalBlockerProviderNotApproved",
  // Non-enumerating: a missing/foreign Service, Vehicle, or Offering is one generic message.
  SERVICE_NOT_FOUND: "rentalErrorResourceUnavailable",
  VEHICLE_NOT_FOUND: "rentalErrorResourceUnavailable",
  OFFERING_NOT_FOUND: "rentalErrorResourceUnavailable",
  WRONG_SERVICE_KIND: "rentalErrorWrongServiceKind",
  VERTICAL_NOT_AUTHORIZED: "rentalBlockerVerticalNotAuthorized",
  VERTICAL_NOT_COMPLIANT: "rentalBlockerVerticalNotCompliant",
  VEHICLE_NOT_SELECTABLE: "rentalBlockerVehicleNotSelectable",
  VERIFIED_CAPACITY_MISSING: "rentalBlockerCapacityMissing",
  INVALID_MONEY: "rentalErrorInvalidMoney",
  INVALID_CURRENCY: "rentalErrorInvalidCurrency",
  CURRENCY_LOCKED: "rentalErrorCurrencyLocked",
  CURRENCY_OVERRIDES_PRESENT: "rentalErrorCurrencyOverridesPresent",
  INVALID_CAPACITY_OVERRIDE: "rentalErrorInvalidCapacityOverride",
  OFFERING_ALREADY_ACTIVE: "rentalErrorOfferingAlreadyActive",
  OFFERING_STATE_CONFLICT: "rentalErrorStateConflict",
  OFFERING_ARCHIVED: "rentalErrorArchived",
  NO_PUBLISHABLE_DAY: "rentalBlockerNoOpenDay",
  INVALID_DATE: "rentalErrorInvalidDate",
  DATE_WINDOW_TOO_LARGE: "rentalErrorDateWindowTooLarge",
  OFFERING_DAY_NOT_FOUND: "rentalErrorDayNotFound",
  INVALID_START_TIME: "rentalErrorUnknown",
  INVALID_INPUT: "rentalErrorInvalidInput",
  UNKNOWN_ERROR: "rentalErrorUnknown",
};

export function rentalActionMessageKey(code: RentalActionCode) {
  return MESSAGE_KEY[code] ?? MESSAGE_KEY.UNKNOWN_ERROR;
}

/** Which create/edit FORM FIELD a validation code attaches to (else form-level). */
export type RentalFormField = "baseDailyAmount" | "currency" | "offeringCapacityOverride" | "service" | "vehicle";

const FIELD_BY_CODE: Partial<Record<RentalActionCode, RentalFormField>> = {
  INVALID_MONEY: "baseDailyAmount",
  INVALID_CURRENCY: "currency",
  CURRENCY_LOCKED: "currency",
  CURRENCY_OVERRIDES_PRESENT: "currency",
  INVALID_CAPACITY_OVERRIDE: "offeringCapacityOverride",
  WRONG_SERVICE_KIND: "service",
  SERVICE_NOT_FOUND: "service",
  VEHICLE_NOT_FOUND: "vehicle",
};

export function rentalErrorField(code: RentalActionCode): RentalFormField | null {
  return FIELD_BY_CODE[code] ?? null;
}
