// Phase 3C — Vehicle Creation from Registration, Slice 3B. Stable coded results for the
// document-first onboarding wizard, mapped to localized provider-namespace keys. Non-enumerating:
// foreign/missing ids collapse to one generic not-found message.

import type { ConfirmationFieldError } from "@/lib/vehicles/registration-review/confirmation-input";

export type OnboardingCode =
  | "NOT_RENTAL_PROVIDER"
  | "VEHICLE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "EXTRACTION_NOT_READY"
  | "INVALID_INPUT"
  | "ALREADY_CREATED"
  | "SUPERSEDED"
  | "NOT_DELETABLE"
  | "CONFLICT"
  | "DUPLICATE_REGISTRATION"
  | "STORAGE_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "UNKNOWN_ERROR";

export type CreateShellResult = { ok: true; vehicleId: string } | { ok: false; code: OnboardingCode };
export type FinalizeResult =
  | { ok: true; vehicleId: string; alreadyCreated: boolean }
  | { ok: false; code: OnboardingCode; fieldErrors?: ConfirmationFieldError[] };
export type DeleteDraftResult = { ok: true } | { ok: false; code: OnboardingCode };

const MESSAGE_KEY: Record<OnboardingCode, string> = {
  NOT_RENTAL_PROVIDER: "vehicleOnboardErrNoAccess",
  VEHICLE_NOT_FOUND: "vehicleOnboardErrNotFound",
  DOCUMENT_NOT_FOUND: "vehicleOnboardErrNotFound", // non-enumerating: same as vehicle-not-found
  EXTRACTION_NOT_READY: "vehicleOnboardErrNotReady",
  INVALID_INPUT: "vehicleOnboardErrInvalid",
  ALREADY_CREATED: "vehicleOnboardErrAlreadyCreated",
  SUPERSEDED: "vehicleOnboardErrSuperseded",
  NOT_DELETABLE: "vehicleOnboardErrNotDeletable",
  CONFLICT: "vehicleOnboardErrConflict",
  DUPLICATE_REGISTRATION: "vehicleOnboardErrDuplicatePlate",
  STORAGE_NOT_CONFIGURED: "vehicleOnboardErrStorage",
  UNAUTHENTICATED: "vehicleOnboardErrAuth",
  UNKNOWN_ERROR: "vehicleOnboardErrUnknown",
};

export function onboardingMessageKey(code: OnboardingCode): string {
  return MESSAGE_KEY[code];
}
