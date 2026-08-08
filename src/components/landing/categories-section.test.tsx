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

const { Link: MockLink } = await import("@/i18n/navigation");
const { CategoriesSection } = await import("./categories-section");

type AnyElement = { type: unknown; props: Record<string, unknown> };

// `.map()`-produced children (the 6 category cards) arrive as a nested
// array literal inside the grid div's props.children, not auto-
// flattened — so this walker must recurse into arrays at any depth,
// not just an element's immediate props.children.
function collectAnchors(element: unknown, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectAnchors(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (el.type === MockLink) acc.push(el);
  if (el.props?.children !== undefined) collectAnchors(el.props.children, acc);
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
    const hrefs = collectAnchors(element).map((a) => a.props.href);

    // Real category slugs drive the grid → each resolves via B2 to a categoryId filter.
    expect(hrefs).toEqual(["/services?category=diving", "/services?category=hiking"]);
  });

  it("falls back to the 6 hardcoded marketing cards when no PUBLIC root categories exist", async () => {
    getPublicRootCategoriesMock.mockResolvedValue([]);

    const element = await CategoriesSection();
    const hrefs = collectAnchors(element).map((a) => a.props.href);

    expect(hrefs).toHaveLength(EXPECTED_SLUGS.length);
    for (const slug of EXPECTED_SLUGS) {
      expect(hrefs).toContain(`/services?category=${slug}`);
    }
    expect(new Set(hrefs).size).toBe(EXPECTED_SLUGS.length);
  });
});
