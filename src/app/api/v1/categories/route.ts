import { getPublicRootCategories } from "@/lib/categories/get-public-root-categories";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { apiOk } from "@/lib/api/v1/respond";
import { toCategoryDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/categories — Gate 1 (Public API Foundation).
//
// Thin adapter over getPublicRootCategories(), which returns ONLY effectively-
// PUBLIC root categories (its publicCategoryWhere rule) — archived/hidden junk
// taxonomy is excluded by the existing reader, not re-filtered here. Public, no
// auth. Locale resolved from the request and passed explicitly.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.categories.list", async () => {
    const locale = resolveApiLocale(request);
    const categories = await getPublicRootCategories(locale);
    return apiOk({ items: categories.map(toCategoryDTO) });
  });
}
