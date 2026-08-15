import type { Locale } from "@/i18n/locales";
import { resolveApiLocale } from "./locale";
import { providerAuthErrorResponse } from "./provider-auth-error";

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
    const mapped = providerAuthErrorResponse(error, locale);
    if (mapped) return mapped;
    throw error;
  }
}
