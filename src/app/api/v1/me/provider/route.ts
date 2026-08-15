import { resolveProviderStatus } from "@/lib/auth";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderWorkspaceStateDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider — Gate PB (Provider Read API).
//
// Authoritative provider WORKSPACE-STATE probe. Unlike the other provider
// endpoints it does NOT require a provider: it resolves the caller's provider
// non-throwingly via resolveProviderStatus(), so a customer with no provider
// gets { exists: false } (200) rather than a 403 — this is the "do I have a
// provider workspace, and is it available?" endpoint. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.state", () =>
    withApiV1Auth(request, async ({ barqUser }) => {
      const lookup = await resolveProviderStatus(barqUser.id);
      const provider =
        lookup.kind === "not_found"
          ? null
          : {
              id: lookup.provider.id,
              status: lookup.provider.status,
              providerType: lookup.provider.providerType,
              visible: lookup.provider.visible,
            };
      return apiOk(toProviderWorkspaceStateDTO(provider));
    })
  );
}
