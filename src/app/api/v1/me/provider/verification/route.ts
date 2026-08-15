import { getProviderVerificationData } from "@/lib/provider/documents/get-provider-verification-data";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderVerificationDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/verification — Gate PB.
//
// Thin adapter over getProviderVerificationData() — the same fail-closed policy
// resolver the approval gate uses. Own documents only (requireProvider). Lets a
// native client render "what do I still need to submit?": the required/optional
// checklist, each requirement's document status, rejectionReason (user-facing),
// requiredTotal/requiredApproved, canProgress, storageAvailable, and
// workspaceAvailable. Available to NON-approved providers too (onboarding).
//
// NEVER exposes objectKey, signed URLs, versionToken, or admin reviewer ids —
// the DTO mapper drops them. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.verification", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const data = await getProviderVerificationData();
      return apiOk(toProviderVerificationDTO(data, locale));
    })
  );
}
