import { getHomeDiscovery } from "@/lib/discovery/get-home-discovery";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";

// GET /api/v1/discovery/home — Home Discovery Foundation.
//
// Thin adapter over the SAME getHomeDiscovery() domain reader the Web Home uses,
// so Web / iOS / Android compose discovery from one authority instead of each
// re-deriving groups from /categories + N x /services. Public, no auth. The
// reader already returns a public-safe shape (only PUBLISHED services via the
// existing security predicate; minimal card fields; no objectKey/private data),
// so there is nothing to strip here. `?region=<GOVERNORATE_CODE>` optionally
// scopes previews; an invalid/absent code = ALL OMAN (the reader validates it).
//
// No breaking change to /api/v1/categories or /api/v1/services — this is additive.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.discovery.home", async () => {
    const locale = resolveApiLocale(request);
    const region = new URL(request.url).searchParams.get("region");
    const discovery = await getHomeDiscovery({ regionCode: region, locale });
    return apiOk(discovery);
  });
}
