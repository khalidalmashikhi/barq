import { describe, it, expect, vi } from "vitest";

// HOME-1 Layer 1: the hero exposes the governorate scope selector. "All Oman"
// clears the scope; each governorate re-scopes the HOME; the currently-selected
// chip is marked aria-current="page".

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props }));

const { HomeHero } = await import("./home-hero");

type AnyElement = { type: unknown; props: Record<string, unknown> };
function collectLinks(element: unknown, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectLinks(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (typeof el.props?.href === "string") acc.push(el);
  if (el.props?.children !== undefined) collectLinks(el.props.children, acc);
  return acc;
}

const govs = [
  { code: "MUSCAT", labelKey: "governorate.MUSCAT" },
  { code: "DHOFAR", labelKey: "governorate.DHOFAR" },
];

describe("HomeHero — governorate scope", () => {
  it("renders All Oman first, then a chip per governorate, each re-scoping the HOME", async () => {
    const links = collectLinks(await HomeHero({ governorates: govs, selectedGovernorate: null }));
    expect(links.map((l) => l.props.href)).toEqual(["/", "/?region=MUSCAT", "/?region=DHOFAR"]);
  });

  it("marks All Oman active when nothing is selected", async () => {
    const links = collectLinks(await HomeHero({ governorates: govs, selectedGovernorate: null }));
    expect(links[0]!.props["aria-current"]).toBe("page");
    expect(links[1]!.props["aria-current"]).toBeUndefined();
  });

  it("marks the selected governorate active (and All Oman inactive)", async () => {
    const links = collectLinks(await HomeHero({ governorates: govs, selectedGovernorate: "DHOFAR" }));
    expect(links[0]!.props["aria-current"]).toBeUndefined();
    expect(links.find((l) => l.props.href === "/?region=DHOFAR")!.props["aria-current"]).toBe("page");
  });
});
