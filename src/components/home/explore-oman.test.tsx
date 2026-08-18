import { describe, it, expect, vi } from "vitest";

// HOME-1 Layer 4: Explore Oman renders the governed governorate metadata as
// graphic tiles that enter the browse surface scoped to each region — no invented
// imagery, no fabricated counts.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({ Link: (props: { href: string; children: unknown }) => props }));

const { ExploreOman } = await import("./explore-oman");

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

describe("ExploreOman", () => {
  it("links each governorate to its region-scoped browse listing", async () => {
    const el = await ExploreOman({
      destinations: [
        { code: "MUSCAT", labelKey: "governorate.MUSCAT" },
        { code: "DHOFAR", labelKey: "governorate.DHOFAR" },
      ],
    });
    expect(collectHrefs(el)).toEqual(["/services?region=MUSCAT", "/services?region=DHOFAR"]);
  });

  it("renders nothing when there is no governorate metadata", async () => {
    expect(await ExploreOman({ destinations: [] })).toBeNull();
  });
});
