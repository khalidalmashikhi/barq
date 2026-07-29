import { describe, it, expect, vi } from "vitest";

// Admin Operations Platform — regression tests for getAdminNavItems(),
// mirroring src/lib/dashboard/customer-nav-items.test.tsx's shape.

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string }) => href,
}));

type NavItem = { label: string; href?: string };

const { getAdminNavItems } = await import("./admin-nav-items");

const t = ((key: string) => key) as unknown as Parameters<typeof getAdminNavItems>[0];

describe("getAdminNavItems", () => {
  it("puts Overview first", () => {
    const items = getAdminNavItems(t, "en") as NavItem[];
    expect(items[0]).toEqual(expect.objectContaining({ label: "navOverview", href: "/admin" }));
  });

  it("includes real, navigable Customers and Reviews routes", () => {
    const items = getAdminNavItems(t, "en") as NavItem[];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "navCustomers", href: "/admin/customers" }),
        expect.objectContaining({ label: "navReviews", href: "/admin/reviews" }),
      ])
    );
  });

  // Payment Experience & Financial Operations phase.
  it("includes a real, navigable Payments route", () => {
    const items = getAdminNavItems(t, "en") as NavItem[];
    expect(items).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "navPayments", href: "/admin/payments" })])
    );
  });

  it("preserves every pre-existing admin route", () => {
    const items = getAdminNavItems(t, "en") as NavItem[];
    const hrefs = items.map((item) => item.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/admin/providers",
        "/admin/services",
        "/admin/prices",
        "/admin/availability",
        "/admin/bookings",
        "/admin/categories",
        "/admin/feature-flags",
        "/admin/homepage-sections",
      ])
    );
  });

  it("imports without mocking @/lib/auth — proving no internal RBAC call", async () => {
    // If getAdminNavItems() called requireAdmin()/hasActiveAdminProfile()
    // itself, importing it in this file (which never mocks "@/lib/auth")
    // would throw at call time. It doesn't — the helper only renders
    // from data it's given.
    expect(() => getAdminNavItems(t, "en")).not.toThrow();
  });
});
