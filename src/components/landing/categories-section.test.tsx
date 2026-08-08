import { describe, it, expect, vi, afterEach } from "vitest";

// UX remediation (category navigation fix) — regression test proving
// every one of the 6 landing-page category cards is a real link to
// "/services?category=<slug>" for its own distinct slug, not just the
// first one (the bug this fix corrects: all 6 previously pointed at
// the same bare "/services").

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: (props: { href: string; children: unknown }) => props,
}));

const getPublicRootCategoriesMock = vi.fn();
vi.mock("@/lib/categories/get-public-root-categories", () => ({
  getPublicRootCategories: (...args: unknown[]) => getPublicRootCategoriesMock(...args),
}));

const { CategoriesSection } = await import("./categories-section");

type AnyElement = { type: unknown; props: Record<string, unknown> };

// The grid now renders one <CategoryDiscoveryCard slug=... /> per category
// (the shared customer-facing card, reused by the admin category preview —
// Unified Preview System). The card resolves slug -> /services?category=<slug>
// internally, so this test asserts on each card's `slug` prop. The walker
// recurses into the nested `.map()` array of card elements.
function collectCardHrefs(element: unknown, acc: string[] = []): string[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectCardHrefs(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (typeof el.props?.slug === "string") acc.push(`/services?category=${el.props.slug as string}`);
  if (el.props?.children !== undefined) collectCardHrefs(el.props.children, acc);
  return acc;
}

const EXPECTED_SLUGS = ["desert-safari", "mountain-tours", "coastal-trips", "cultural-tours", "city-experiences", "adventure-sports"];

afterEach(() => getPublicRootCategoriesMock.mockReset());

describe("CategoriesSection — DB-driven with hardcoded fallback (Gap A)", () => {
  it("renders the real admin-managed PUBLIC root categories (by slug) when they exist", async () => {
    getPublicRootCategoriesMock.mockResolvedValue([
      { id: "c1", slug: "diving", label: "Diving" },
      { id: "c2", slug: "hiking", label: "Hiking" },
    ]);

    const element = await CategoriesSection();
    const hrefs = collectCardHrefs(element);

    // Real category slugs drive the grid → each resolves via B2 to a categoryId filter.
    expect(hrefs).toEqual(["/services?category=diving", "/services?category=hiking"]);
  });

  it("falls back to the 6 hardcoded marketing cards when no PUBLIC root categories exist", async () => {
    getPublicRootCategoriesMock.mockResolvedValue([]);

    const element = await CategoriesSection();
    const hrefs = collectCardHrefs(element);

    expect(hrefs).toHaveLength(EXPECTED_SLUGS.length);
    for (const slug of EXPECTED_SLUGS) {
      expect(hrefs).toContain(`/services?category=${slug}`);
    }
    expect(new Set(hrefs).size).toBe(EXPECTED_SLUGS.length);
  });
});
