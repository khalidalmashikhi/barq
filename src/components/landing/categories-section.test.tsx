import { describe, it, expect, vi } from "vitest";

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

describe("CategoriesSection — category links", () => {
  it("links each of the 6 category cards to /services?category=<its own distinct slug>", async () => {
    const element = await CategoriesSection();
    const anchors = collectAnchors(element);
    const hrefs = anchors.map((a) => a.props.href);

    expect(hrefs).toHaveLength(EXPECTED_SLUGS.length);
    for (const slug of EXPECTED_SLUGS) {
      expect(hrefs).toContain(`/services?category=${slug}`);
    }
    // Every href must be distinct — the exact regression this fix corrects.
    expect(new Set(hrefs).size).toBe(EXPECTED_SLUGS.length);
  });
});
