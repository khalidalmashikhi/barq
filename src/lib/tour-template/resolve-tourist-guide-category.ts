import "server-only";
import { prisma } from "@/lib/db";
import { TOURIST_GUIDE_CATEGORY_SLUG } from "./eligibility";

// Smart Tour-Guide Template — server-only resolver (TOUR-1). Resolves the
// canonical tourist-guide category id from its STABLE slug (the id is per-
// environment). Returns null when the taxonomy row is absent (e.g. an environment
// that never ran the bootstrap) — callers then treat every service as ineligible
// (fail-closed). Kept separate from the pure eligibility predicate so that
// predicate stays importable by non-server modules.

export async function resolveTouristGuideCategoryId(): Promise<string | null> {
  const category = await prisma.category.findUnique({
    where: { slug: TOURIST_GUIDE_CATEGORY_SLUG },
    select: { id: true },
  });
  return category?.id ?? null;
}
