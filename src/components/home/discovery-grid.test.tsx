import { describe, it, expect, vi } from "vitest";

// HOME-1 Layer 2 regression: the "What are you looking for?" grid renders exactly
// the six approved discovery groups, in canonical registry order, each linking to
// its own group-scoped listing — and MORE is the browse-everything catch-all, not
// a ?group= bucket.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: { href: string; children: unknown }) => props,
}));

const { DiscoveryGrid } = await import("./discovery-grid");

type AnyElement = { type: unknown; props: Record<string, unknown> };

function collectHrefs(element: unknown, acc: string[] = []): string[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectHrefs(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (typeof el.props?.href === "string") acc.push(el.props.href as string);
  if (el.props?.children !== undefined) collectHrefs(el.props.children, acc);
  return acc;
}

describe("DiscoveryGrid — the six discovery groups", () => {
  it("renders exactly six cards in canonical order (All Oman)", async () => {
    const hrefs = collectHrefs(await DiscoveryGrid({ region: null }));
    expect(hrefs).toEqual([
      "/services?group=EXPERIENCES",
      "/services?group=TOURIST_GUIDES",
      "/services?group=TRANSPORT",
      "/services?group=CAR_RENTAL",
      "/services?group=MARINE_TRIPS",
      "/services", // MORE — catch-all, never ?group=MORE
    ]);
  });

  it("threads the selected governorate into every card href", async () => {
    const hrefs = collectHrefs(await DiscoveryGrid({ region: "DHOFAR" }));
    expect(hrefs[0]).toBe("/services?group=EXPERIENCES&region=DHOFAR");
    expect(hrefs[hrefs.length - 1]).toBe("/services?region=DHOFAR"); // MORE stays filter-free
    expect(hrefs).toHaveLength(6);
  });
});
