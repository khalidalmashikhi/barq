import { describe, it, expect } from "vitest";
import { buildBottomNavTabs } from "./bottom-nav-tabs";

// Marketplace Foundation (Phase 1) — mobile bottom-nav tab logic. Presentation
// only; these assert the hrefs and active-state resolution, not authorization
// (server guards remain authoritative).

describe("buildBottomNavTabs", () => {
  it("always exposes exactly the 5 marketplace tabs in order", () => {
    const keys = buildBottomNavTabs(true, "/").map((t) => t.key);
    expect(keys).toEqual(["home", "explore", "bookings", "notifications", "account"]);
  });

  it("anonymous: protected tabs route through /login; Home/Explore are public", () => {
    const tabs = buildBottomNavTabs(false, "/");
    const href = (k: string) => tabs.find((t) => t.key === k)!.href;
    expect(href("home")).toBe("/");
    expect(href("explore")).toBe("/services");
    expect(href("bookings")).toBe("/login");
    expect(href("notifications")).toBe("/login");
    expect(href("account")).toBe("/login");
  });

  it("authenticated: protected tabs point at their real routes (Account → /dashboard)", () => {
    const tabs = buildBottomNavTabs(true, "/");
    const href = (k: string) => tabs.find((t) => t.key === k)!.href;
    expect(href("bookings")).toBe("/bookings");
    expect(href("notifications")).toBe("/notifications");
    expect(href("account")).toBe("/dashboard"); // capability doorways live there, not here
  });

  it("active state follows the (locale-stripped) pathname", () => {
    const active = (path: string) =>
      buildBottomNavTabs(true, path)
        .filter((t) => t.active)
        .map((t) => t.key);
    expect(active("/")).toEqual(["home"]);
    expect(active("/services")).toEqual(["explore"]);
    expect(active("/services/abc")).toEqual(["explore"]); // detail page keeps Explore active
    expect(active("/bookings")).toEqual(["bookings"]);
    expect(active("/notifications")).toEqual(["notifications"]);
    expect(active("/dashboard")).toEqual(["account"]);
    expect(active("/dashboard/settings")).toEqual(["account"]);
    expect(active("/about")).toEqual([]); // no false-positive Home match on other pages
  });
});
