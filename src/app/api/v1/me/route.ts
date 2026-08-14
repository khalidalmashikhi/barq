import { resolveProviderStatus } from "@/lib/auth";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { toMeDTO, type MeProviderDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me — Gate 2 (Authenticated Customer Read).
//
// Returns the smallest useful authenticated identity DTO. A User is the single
// account identity; Provider is an OPTIONAL, additive capability on the same
// account (never a mutually-exclusive role), resolved via the existing
// resolveProviderStatus() so iOS can pick the right provider entry point
// (become / application-status / workspace) from ProviderStatus. Never exposes
// auth secrets, Better Auth internals, ProviderDocument, or private metadata.
// Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me", () =>
    withApiV1Auth(request, async ({ barqUser, locale }) => {
      const lookup = await resolveProviderStatus(barqUser.id);

      const provider: MeProviderDTO =
        lookup.kind === "not_found"
          ? { exists: false, status: null, type: null, workspaceAvailable: false }
          : {
              exists: true,
              status: lookup.provider.status,
              type: lookup.provider.providerType,
              workspaceAvailable: lookup.provider.status === "APPROVED",
            };

      return apiOk(toMeDTO(barqUser, provider, locale));
    })
  );
}
