import { describe, it, expect, vi } from "vitest";

// The marketplace card must be ONE anchor to the service detail page, with no
// nested interactive elements (guards against the <a> inside <a> hydration
// regression) and no inert favorite button.

function LinkMock() {
  return null;
}
vi.mock("@/i18n/navigation", () => ({ Link: LinkMock }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("framer-motion", () => ({
  motion: { article: (props: Record<string, unknown>) => ({ __article: true, props }) },
}));
vi.mock("./destination-image", () => ({ DestinationImage: () => null }));
vi.mock("@/components/ui/brand-pattern", () => ({
  BrandPattern: () => null,
  getBrandPatternTone: () => "a",
}));

const { ExperienceCard } = await import("./experience-card");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit));
    return;
  }
  visit(node);
  const children = node.props?.children ?? node.props?.props?.children;
  if (children !== undefined) walk(children, visit);
}

describe("ExperienceCard", () => {
  it("is a single anchor to the service detail page, with no nested links or buttons", () => {
    const tree = ExperienceCard({ serviceId: "svc-1", title: "Desert Trek", providerName: "Acme", price: "25 OMR" });

    let linkCount = 0;
    let linkHref: string | undefined;
    let buttonCount = 0;
    walk(tree, (n) => {
      if (n.type === LinkMock) {
        linkCount += 1;
        linkHref = n.props?.href as string;
      }
      if (n.type === "button" || n.type === "a") buttonCount += 1;
    });

    expect(linkCount).toBe(1); // exactly one navigational element
    expect(linkHref).toBe("/services/svc-1");
    expect(buttonCount).toBe(0); // no favorite button, no nested raw anchor
  });
});
