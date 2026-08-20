import type { NextResponse } from "next/server";
import type { Locale } from "@/i18n/locales";
import type { AssetDocumentErrorCode } from "@/lib/vehicles/documents/asset-document-errors";
import { apiError, type ApiErrorCode } from "./errors";

// VEHICLE-LC2B — maps the EXISTING authoritative LC2 vehicle-document / verification
// domain codes onto the API v1 error envelope. Like the other *-errors mappers, it
// ONLY translates a stable domain code to HTTP + wire shape; it never changes a
// domain meaning and never surfaces a raw exception/Prisma/storage string.
//
// OWNERSHIP + PATH-BINDING ARE UNIFORM-404 (anti-enumeration): both VEHICLE_NOT_FOUND
// and DOCUMENT_NOT_FOUND (which already fold in "foreign provider" and "assetId !==
// vehicleId" mismatches at the domain layer) map to a single NOT_FOUND — a caller can
// never tell "doesn't exist" from "belongs to someone else" from "wrong vehicle".
//
// The FILE-VALIDATION codes (EMPTY_FILE / TOO_LARGE / UNSUPPORTED_TYPE /
// SIGNATURE_MISMATCH) all surface as 400 INVALID_INPUT with the specific reason in
// details.reason, so a native client gets one stable top-level code plus a
// machine-readable discriminator without a proliferation of HTTP codes.

const CODE_MAP: Record<AssetDocumentErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_PROVIDER_PROFILE: "NO_PROVIDER_PROFILE",
  PROVIDER_NOT_APPROVED: "PROVIDER_NOT_APPROVED",
  VEHICLE_NOT_FOUND: "NOT_FOUND",
  DOCUMENT_NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "DOCUMENT_ALREADY_EXISTS",
  LOCKED: "DOCUMENT_LOCKED",
  // File-validation reasons → 400 INVALID_INPUT (+ details.reason below).
  EMPTY_FILE: "INVALID_INPUT",
  TOO_LARGE: "INVALID_INPUT",
  UNSUPPORTED_TYPE: "INVALID_INPUT",
  SIGNATURE_MISMATCH: "INVALID_INPUT",
  // Submission readiness failed (required docs missing/rejected) → 422 (+ blockers).
  NOT_READY: "VERIFICATION_NOT_READY",
  // Not submittable from the current verification state (e.g. already SUBMITTED).
  INVALID_STATE: "INVALID_STATUS_TRANSITION",
  // Server-side conditions — never the client's fault, never leak internals.
  STORAGE_NOT_CONFIGURED: "INTERNAL_ERROR",
  UPLOAD_FAILED: "INTERNAL_ERROR",
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

// File-validation codes that ride a machine-readable reason discriminator.
const FILE_VALIDATION_CODES: ReadonlySet<AssetDocumentErrorCode> = new Set([
  "EMPTY_FILE",
  "TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "SIGNATURE_MISMATCH",
]);

/**
 * Build the API v1 error response for an LC2 vehicle-document/verification code.
 * `extraDetails` carries structured, human-safe extras onto the wire (e.g. the
 * submission `blockers` for NOT_READY) — never raw internals.
 */
export function vehicleDocumentErrorResponse(
  code: AssetDocumentErrorCode,
  locale: Locale,
  extraDetails?: Record<string, unknown>,
): NextResponse {
  const mapped = CODE_MAP[code] ?? "INTERNAL_ERROR";
  const details: Record<string, unknown> = { ...extraDetails };
  if (FILE_VALIDATION_CODES.has(code)) details.reason = code;
  return apiError(mapped, { locale, details: Object.keys(details).length > 0 ? details : undefined });
}
