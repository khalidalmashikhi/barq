// EXCLUSIVE PHONE-FIRST REGISTRATION — Gate Z-2. Stable, safe error codes for the
// registration server actions. Never leak internal/Prisma detail; the UI maps each
// code to a localized message (auth namespace).

export type RegistrationErrorCode =
  | "INVALID_TYPE"
  | "INVALID_NAME"
  | "ALREADY_CLASSIFIED"
  | "NO_DECLARED_TYPE"
  | "NAME_REQUIRED"
  | "PHONE_NOT_VERIFIED"
  | "EMAIL_NOT_VERIFIED"
  | "PROFILE_CONFLICT"
  | "UNKNOWN_ERROR";

export type RegistrationResult = { ok: true } | { ok: false; error: RegistrationErrorCode };

const REGISTRATION_ERROR_TRANSLATION_KEYS = {
  INVALID_TYPE: "registrationErrorInvalidType",
  INVALID_NAME: "registrationErrorInvalidName",
  ALREADY_CLASSIFIED: "registrationErrorAlreadyClassified",
  NO_DECLARED_TYPE: "registrationErrorNoDeclaredType",
  NAME_REQUIRED: "registrationErrorNameRequired",
  PHONE_NOT_VERIFIED: "registrationErrorPhoneNotVerified",
  EMAIL_NOT_VERIFIED: "registrationErrorEmailNotVerified",
  PROFILE_CONFLICT: "registrationErrorProfileConflict",
  UNKNOWN_ERROR: "registrationErrorUnknown",
} as const satisfies Record<RegistrationErrorCode, string>;

export function isRegistrationErrorCode(value: string): value is RegistrationErrorCode {
  return value in REGISTRATION_ERROR_TRANSLATION_KEYS;
}

export function getRegistrationErrorTranslationKey(code: RegistrationErrorCode): string {
  return REGISTRATION_ERROR_TRANSLATION_KEYS[code];
}
