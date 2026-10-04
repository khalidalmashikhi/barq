// Phase 3C — Vehicle Creation from Registration, Slice 3B. Stable coded results for the
// document-first onboarding wizard, mapped to localized provider-namespace keys. Non-enumerating:
// foreign/missing ids collapse to one generic not-found message.

import type { ConfirmationFieldError } from "@/lib/vehicles/registration-review/confirmation-input";

export type OnboardingCode =
  | "PROVIDER_NOT_APPROVED"
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
// Field-level errors for the review form: the confirmation fields plus the wizard-only inputs.
export type OnboardingFieldError = { field: ConfirmationFieldError["field"] | "vehicleType" | "publicDescription"; code: string };

export type FinalizeResult =
  | { ok: true; vehicleId: string; alreadyCreated: boolean }
  | { ok: false; code: OnboardingCode; fieldErrors?: OnboardingFieldError[] };
export type DeleteDraftResult = { ok: true } | { ok: false; code: OnboardingCode };

const MESSAGE_KEY: Record<OnboardingCode, string> = {
  PROVIDER_NOT_APPROVED: "vehicleOnboardErrNoAccess",
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
