// Import the error classes from the lightweight leaf module (no server-only / no
// Better Auth deps) rather than the @/lib/auth barrel — keeps this helper cheap
// to load and lets tests match instanceof against the same real classes.
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import type { Locale } from "@/i18n/locales";
import { resolveApiLocale } from "./locale";
import { apiError } from "./errors";

// API v1 provider gate — Gate PB (Provider Read API).
//
// The provider read endpoints call the EXISTING authoritative provider readers
// (src/lib/provider/**), which each resolve provider.id from the session via
// requireProvider() and throw the standard auth errors. This wrapper maps those
// thrown errors to the Gate-1 error envelope, distinguishing the provider cases:
//   - UnauthenticatedError (no session)                         -> 401 UNAUTHORIZED
//   - ForbiddenError code "PROVIDER_DEACTIVATED"                -> 403 FORBIDDEN
//   - ForbiddenError code "PROVIDER_NOT_APPROVED"               -> 403 PROVIDER_NOT_APPROVED
//   - ForbiddenError (no provider row, "Provider role required")-> 403 NO_PROVIDER_PROFILE
//   - USER_INACTIVE (suspended/deactivated account)            -> 403 FORBIDDEN
// It NEVER introduces a token/bearer/second auth system — it only reuses
// requireProvider() (via the readers) and maps its result. Reads follow existing
// web/domain rules: requireProvider admits APPLIED/UNDER_REVIEW/REJECTED providers
// (only SUSPENDED/DEACTIVATED are blocked), exactly like the web provider pages;
// requireApprovedProvider (mutations) is deliberately NOT used here.
//
// NOTE: `/api/v1/me/provider` (workspace-state) does NOT use this wrapper — it
// resolves the provider non-throwingly (resolveProviderStatus) so a customer with
// no provider gets { exists: false } rather than a 403.

export async function withApiV1Provider(
  request: Request,
  handler: (context: { locale: Locale }) => Promise<Response>
): Promise<Response> {
  const locale = resolveApiLocale(request);

  try {
    return await handler({ locale });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return apiError("UNAUTHORIZED", { locale });
    if (error instanceof ForbiddenError) {
      if (error.code === "PROVIDER_NOT_APPROVED") return apiError("PROVIDER_NOT_APPROVED", { locale });
      if (error.code === "PROVIDER_DEACTIVATED" || error.code === "USER_INACTIVE") {
        return apiError("FORBIDDEN", { locale });
      }
      // requireProvider throws a plain ForbiddenError ("Provider role required",
      // no code) when the authenticated user has no Provider row.
      return apiError("NO_PROVIDER_PROFILE", { locale });
    }
    throw error;
  }
}
