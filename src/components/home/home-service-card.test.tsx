import { describe, it, expect, vi } from "vitest";
import { BrandPattern } from "@/components/ui/brand-pattern";

// HOME-1 minimal service card: honours the {name, coverUrl, region, price} DTO
// and NOTHING more — no provider name, no badge/status/rating, approved fallback
// when the cover is missing.

vi.mock("@/i18n/navigation", () => ({
  Link: (props: Record<string, unknown>) => ({ __link: true, ...props }),
}));

const { HomeServiceCard } = await import("./home-service-card");

type AnyElement = { type: unknown; props: Record<string, unknown> };

function walk(element: unknown, visit: (el: AnyElement) => void): void {
  if (!element || typeof element !== "object") return;
  if (Array.isArray(element)) {
    for (const child of element) walk(child, visit);
    return;
  }
  const el = element as AnyElement;
  visit(el);
  if (el.props?.children !== undefined) walk(el.props.children, visit);
}

function collectStrings(element: unknown, acc: string[] = []): string[] {
  if (typeof element === "string") {
    acc.push(element);
    return acc;
  }
  if (!element || typeof element !== "object") return acc;
  if (Array.isArray(element)) {
    for (const child of element) collectStrings(child, acc);
    return acc;
  }
  collectStrings((element as AnyElement).props?.children, acc);
  return acc;
}

describe("HomeServiceCard", () => {
  const base = {
    href: "/services/svc-1",
    name: "Wadi Shab Day Trip",
    locationLabel: "Muscat",
    priceLabel: "From 10.00 OMR",
    seed: "svc-1",
  };

  it("renders the real cover image (alt = name) when a coverUrl is present", () => {
    const el = HomeServiceCard({ ...base, coverUrl: "https://cdn/x.jpg" });
    let img: AnyElement | null = null;
    walk(el, (e) => {
      if (e.type === "img") img = e;
    });
    expect(img).not.toBeNull();
    expect(img!.props.src).toBe("https://cdn/x.jpg");
    expect(img!.props.alt).toBe("Wadi Shab Day Trip");
  });

  it("falls back to the brand pattern (no <img>) when the cover is missing", () => {
    const el = HomeServiceCard({ ...base, coverUrl: null });
    let hasImg = false;
    let hasBrandPattern = false;
    walk(el, (e) => {
      if (e.type === "img") hasImg = true;
      if (e.type === BrandPattern) hasBrandPattern = true;
    });
    expect(hasImg).toBe(false);
    expect(hasBrandPattern).toBe(true);
  });

  it("shows ONLY the DTO facts: title, one location, starting price — no provider name", () => {
    const strings = collectStrings(HomeServiceCard({ ...base, coverUrl: null }));
    expect(strings).toContain("Wadi Shab Day Trip");
    expect(strings).toContain("Muscat");
    expect(strings).toContain("From 10.00 OMR");
    // The DTO carries no provider identity; nothing provider-shaped can appear.
    expect(strings.join(" ")).not.toMatch(/provider/i);
  });

  it("omits the location and price rows entirely when those facts are absent", () => {
    const strings = collectStrings(HomeServiceCard({ ...base, coverUrl: null, locationLabel: null, priceLabel: null }));
    expect(strings).toContain("Wadi Shab Day Trip");
    expect(strings).not.toContain("Muscat");
    expect(strings).not.toContain("From 10.00 OMR");
  });

  it("is a single link to the service detail page", () => {
    const el = HomeServiceCard({ ...base, coverUrl: null }) as unknown as AnyElement;
    expect(el.props.href).toBe("/services/svc-1");
    expect(el.props["aria-label"]).toBe("Wadi Shab Day Trip");
  });
});
