import type { NextResponse } from "next/server";
// Import the error CLASSES from the lightweight leaf module (no server-only / no
// Better Auth deps) so this mapper — and its static test — match instanceof against
// the exact same real classes requireProvider() throws.
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import type { Locale } from "@/i18n/locales";
import { apiError } from "./errors";

// Shared provider auth-error → API v1 envelope mapping — Gate PC.
//
// Both provider gates (withApiV1Provider for reads, withApiV1ProviderMutation for
// mutations) map the SAME set of thrown auth errors to the SAME envelope, so that
// mapping lives here once instead of being duplicated (and drifting) in each. It is
// a pure function of (error, locale): it maps the recognized auth errors and returns
// null for anything else, so the caller rethrows non-auth errors as a real 500.
//
//   - UnauthenticatedError (no session)                            -> 401 UNAUTHORIZED
//   - ForbiddenError code "PROVIDER_NOT_APPROVED"                  -> 403 PROVIDER_NOT_APPROVED
//   - ForbiddenError code "PROVIDER_DEACTIVATED" / "USER_INACTIVE" -> 403 FORBIDDEN
//   - ForbiddenError (no provider row, no code)                    -> 403 NO_PROVIDER_PROFILE
//   - anything else                                                -> null (caller rethrows)

export function providerAuthErrorResponse(error: unknown, locale: Locale): NextResponse | null {
  if (error instanceof UnauthenticatedError) return apiError("UNAUTHORIZED", { locale });
  if (error instanceof ForbiddenError) {
    if (error.code === "PROVIDER_NOT_APPROVED") return apiError("PROVIDER_NOT_APPROVED", { locale });
    if (error.code === "PROVIDER_DEACTIVATED" || error.code === "USER_INACTIVE") {
      return apiError("FORBIDDEN", { locale });
    }
    // requireProvider throws a plain ForbiddenError ("Provider role required", no
    // code) when the authenticated user has no Provider row.
    return apiError("NO_PROVIDER_PROFILE", { locale });
  }
  return null;
}
