import { getProviderProfile } from "@/lib/services/get-provider-profile";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderPublicDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/providers/{idOrSlug} — Gate 1 (Public API Foundation).
//
// Thin adapter over getProviderProfile(), which returns ONLY APPROVED + visible
// providers (null otherwise ⇒ uniform 404) and NEVER exposes contactEmail
// (BR-002), verification documents, or account/auth fields — the DTO mapper
// copies an allow-list of public fields only. Public, no auth.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ idOrSlug: string }> }) {
  return withRequestTracing("api.v1.providers.detail", async () => {
    const { idOrSlug } = await params;
    const locale = resolveApiLocale(request);

    const provider = await getProviderProfile(idOrSlug, locale);
    if (!provider) return apiError("NOT_FOUND", { locale });

    return apiOk(toProviderPublicDTO(provider));
  });
}
