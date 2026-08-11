import { describe, it, expect, vi } from "vitest";

// Regression: the homepage discovery grid renders exactly the 4 approved
// ADR-0016 v1 families, each a real link to /services?category=<slug> for its
// own distinct slug (code-defined; no DB dependency, so no junk categories).

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: (props: { href: string; children: unknown }) => props,
}));

const { CategoriesSection } = await import("./categories-section");

type AnyElement = { type: unknown; props: Record<string, unknown> };

// Collect the slug of each rendered <CategoryDiscoveryCard slug=... />.
function collectCardSlugs(element: unknown, acc: string[] = []): string[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectCardSlugs(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (typeof el.props?.slug === "string") acc.push(el.props.slug as string);
  if (el.props?.children !== undefined) collectCardSlugs(el.props.children, acc);
  return acc;
}

describe("CategoriesSection — ADR-0016 v1 discovery families", () => {
  it("renders the 4 approved families in order, each with its own slug", async () => {
    const element = await CategoriesSection();
    const slugs = collectCardSlugs(element);
    expect(slugs).toEqual(["cars", "tours-experiences", "marine-trips", "transfers"]);
  });
});
