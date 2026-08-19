import { describe, it, expect } from "vitest";
import { navLinks } from "./nav-links";

// AUTH-NAV-3 — the shared nav list (rendered by Navbar, Footer, and MobileNav)
// must carry no dead Home anchors. HOME-1 removed the #how-it-works / #destinations
// sections, so every consumer inherits a clean list from this single source.

describe("navLinks — no dead Home anchors", () => {
  it("contains only real, working route destinations (no in-page # anchors)", () => {
    for (const link of navLinks) {
      expect(link.href.startsWith("#")).toBe(false);
    }
  });

  it("no longer references the removed #how-it-works / #destinations sections", () => {
    const hrefs = navLinks.map((l) => l.href);
    expect(hrefs).not.toContain("#how-it-works");
    expect(hrefs).not.toContain("#destinations");
  });

  it("keeps Browse (→ /services) as the real destination", () => {
    expect(navLinks.map((l) => l.href)).toContain("/services");
  });

  it("does NOT expose the provider-only My Vehicles workspace in public/customer nav (VEHICLE-2)", () => {
    expect(navLinks.some((l) => l.href.includes("/provider/vehicles"))).toBe(false);
  });
});
