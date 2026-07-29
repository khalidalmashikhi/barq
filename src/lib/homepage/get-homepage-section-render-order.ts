import "server-only";
import { prisma } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/feature-flags/is-feature-enabled";
import { logger } from "@/lib/logger";

// Public Homepage Sections read path — Phase 1.5 (Homepage Rendering).
// Resolves the ordered list of section keys the public homepage should
// render. No requireAdmin() gate: this is called from the public
// landing page itself, same reasoning as isFeatureEnabled().
//
// Deliberately defaults to `defaultKeys` (today's static, hardcoded
// order) unchanged, and only switches to the database-driven order when
// ALL of the following hold:
//   1. The `homepage_dynamic_sections` feature flag is enabled — an
//      explicit admin opt-in, not an automatic behavior change on
//      deploy. Turning it back off is an instant, code-free rollback.
//   2. At least one HomepageSection row is visible. Phase 1.4 shipped
//      the backend with zero seeded rows, so an empty result almost
//      certainly means "no admin has configured this yet," not "hide
//      the whole homepage" — falling back to the static order keeps the
//      page looking exactly as it does today until an admin actually
//      acts.
//   3. The database is reachable. Any query failure logs and falls back
//      to the static order rather than ever risking a broken homepage.
//
// Keys returned by the database that don't match any of `defaultKeys`
// (typos, keys for sections that no longer exist) are silently dropped
// rather than crashing the page.

export const HOMEPAGE_DYNAMIC_SECTIONS_FLAG_KEY = "homepage_dynamic_sections";

export async function getHomepageSectionRenderOrder(defaultKeys: readonly string[]): Promise<string[]> {
  const dynamicSectionsEnabled = await isFeatureEnabled(HOMEPAGE_DYNAMIC_SECTIONS_FLAG_KEY);
  if (!dynamicSectionsEnabled) {
    return [...defaultKeys];
  }

  try {
    const sections = await prisma.homepageSection.findMany({
      where: { visible: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { key: true },
    });

    if (sections.length === 0) {
      return [...defaultKeys];
    }

    const knownKeys = new Set(defaultKeys);
    return sections.map((section) => section.key).filter((key) => knownKeys.has(key));
  } catch (error) {
    logger.error("homepage.section_render_order_lookup_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [...defaultKeys];
  }
}
