import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Marketplace Foundation (Phase 1) — guards the marketplace-first default
// homepage order. Reads the source (rather than importing the registry, which
// pulls in server-component/DB imports) and checks the ordered key list.
const SRC = readFileSync(join(process.cwd(), "src/components/landing/homepage-section-registry.tsx"), "utf8");
const arrayBlock = SRC.match(/DEFAULT_HOMEPAGE_SECTION_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] ?? "";
const order = [...arrayBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
const idx = (key: string) => order.indexOf(key);

describe("default homepage order — marketplace-first", () => {
  it("leads with the hero, then bookable categories, then real inventory", () => {
    expect(order[0]).toBe("hero");
    expect(order[1]).toBe("categories");
    expect(order[2]).toBe("featured_experiences");
  });

  it("prioritizes marketplace sections above the informational/SEO sections", () => {
    for (const marketplace of ["categories", "featured_experiences", "providers"]) {
      for (const informational of ["how_it_works", "why_choose", "stats", "testimonials", "faq"]) {
        expect(idx(marketplace)).toBeLessThan(idx(informational));
      }
    }
  });

  it("keeps all 13 original sections (nothing dropped, only reordered)", () => {
    expect(new Set(order)).toEqual(
      new Set([
        "hero",
        "categories",
        "featured_experiences",
        "providers",
        "trust_bar",
        "credibility_strip",
        "how_it_works",
        "destinations",
        "cta",
        "why_choose",
        "stats",
        "testimonials",
        "faq",
      ])
    );
    expect(order.length).toBe(13);
  });
});
