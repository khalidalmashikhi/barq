import { getProviderProfileForEdit } from "@/lib/provider/queries/get-provider-profile-for-edit";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderProfileDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/profile — Gate PB.
//
// Thin adapter over getProviderProfileForEdit(), which resolves the caller's own
// provider via requireProvider() (no provider → NO_PROVIDER_PROFILE via the
// wrapper). Returns the provider's own editable fields (bilingual name/description
// + contactEmail self-view). No internal/admin/auth fields. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.profile", () =>
    withApiV1Provider(request, async () => {
      const profile = await getProviderProfileForEdit();
      return apiOk(toProviderProfileDTO(profile));
    })
  );
}
