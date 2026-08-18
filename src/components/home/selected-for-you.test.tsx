import { describe, it, expect, vi } from "vitest";
import { HomeServiceCard } from "./home-service-card";

// HOME-1 Layer 3: the "Selected for you" carousel maps the read model's
// deterministic `recommended` list to minimal cards — threading a localized
// region label and a "From {price}" label — and renders nothing when empty.

vi.mock("@/lib/i18n/get-server-translator", () => ({
  // Echoes the key, and for ICU calls appends the price so threading is visible.
  getServerTranslator: async () => (key: string, params?: Record<string, unknown>) =>
    params?.price ? `${key}:${params.price}` : key,
}));
vi.mock("@/i18n/navigation", () => ({ Link: (props: Record<string, unknown>) => props }));

const { SelectedForYou } = await import("./selected-for-you");

type AnyElement = { type: unknown; props: Record<string, unknown> };

function collectCards(element: unknown, acc: AnyElement[] = []): AnyElement[] {
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectCards(child, acc);
    return acc;
  }
  const el = element as AnyElement;
  if (el.type === HomeServiceCard) acc.push(el);
  if (el.props?.children !== undefined) collectCards(el.props.children, acc);
  return acc;
}

const card = (over: Partial<Record<string, unknown>>) => ({
  id: "a",
  name: "A",
  coverUrl: "cover-a",
  regionCode: "DHOFAR",
  price: "10.00 OMR",
  ...over,
});

describe("SelectedForYou", () => {
  it("renders one minimal card per recommended item, with resolved region + price labels", async () => {
    const el = await SelectedForYou({ items: [card({}) as never] });
    const cards = collectCards(el);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.props).toMatchObject({
      href: "/services/a",
      name: "A",
      coverUrl: "cover-a",
      locationLabel: "governorate.DHOFAR",
      priceLabel: "home.priceFrom:10.00 OMR",
      seed: "a",
    });
  });

  it("omits location/price labels for items missing region/price (never fabricated)", async () => {
    const el = await SelectedForYou({ items: [card({ id: "b", regionCode: null, price: null }) as never] });
    const [c] = collectCards(el);
    expect(c!.props.locationLabel).toBeNull();
    expect(c!.props.priceLabel).toBeNull();
  });

  it("preserves the deterministic order of the recommended list", async () => {
    const items = [card({ id: "x" }), card({ id: "y" }), card({ id: "z" })] as never[];
    const cards = collectCards(await SelectedForYou({ items }));
    expect(cards.map((c) => c.props.href)).toEqual(["/services/x", "/services/y", "/services/z"]);
  });

  it("renders nothing (honest empty) when there are no recommendations", async () => {
    expect(await SelectedForYou({ items: [] })).toBeNull();
  });
});
