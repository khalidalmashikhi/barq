import { describe, it, expect } from "vitest";
import { buildBottomNavTabs, isCustomerBottomNavSurface } from "./bottom-nav-tabs";

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

describe("isCustomerBottomNavSurface (Phase 3C Slice A — explicit allowlist route gating)", () => {
  it("SHOWS on the customer marketplace + account surfaces", () => {
    for (const p of [
      "/",
      "/services",
      "/services/019f4e4e-8116-7052-b15e-b79b5ccb1af9",
      "/services/019f4e4e-8116-7052-b15e-b79b5ccb1af9/book",
      "/providers",
      "/providers/muscat-trails",
      "/bookings",
      "/bookings/abc",
      "/bookings/abc/confirmation",
      "/notifications",
      "/dashboard",
      "/dashboard/settings",
      "/payments",
      "/payments/xyz",
      "/reviews",
    ]) {
      expect(isCustomerBottomNavSurface(p)).toBe(true);
    }
  });

  it("HIDES on provider/admin/auth/onboarding and other non-customer surfaces", () => {
    for (const p of [
      "/provider",
      "/provider/services",
      "/admin",
      "/admin/providers/x",
      "/login",
      "/onboarding",
      "/provider-application",
      "/verify",
      "/about",
      "/contact",
      "/help",
      "/privacy",
      "/terms",
      "/cookies",
      "/booking-policy",
    ]) {
      expect(isCustomerBottomNavSurface(p)).toBe(false);
    }
  });

  it("HIDES on unknown / 404 / error routes (allowlist can never leak onto them)", () => {
    for (const p of ["/nonexistent", "/xyz", "/services-extra", "/dashboardx", "/book", "/500", "/not-found"]) {
      expect(isCustomerBottomNavSurface(p)).toBe(false);
    }
  });

  it("does not match a prefix as a substring of an unrelated segment", () => {
    // "/services-extra" must NOT match the "/services" prefix (boundary-correct).
    expect(isCustomerBottomNavSurface("/servicesabc")).toBe(false);
    expect(isCustomerBottomNavSurface("/bookingsx")).toBe(false);
  });
});
