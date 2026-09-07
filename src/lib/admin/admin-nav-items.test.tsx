import { describe, it, expect, vi } from "vitest";
import type { PermissionKey } from "@/lib/auth/permissions";

// STAFF RBAC (Gate Z-3) — getAdminNavItems() is PERMISSION-DRIVEN. Pure (no @/lib/auth
// call): it renders from the {permissions, isAdmin, isOwner} context it is given.

vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string }) => href }));

const { getAdminNavItems, firstAllowedAdminPath } = await import("./admin-nav-items");
type NavItem = { label: string; href?: string };
const t = ((key: string) => key) as unknown as Parameters<typeof getAdminNavItems>[0];

const OWNER = { permissions: new Set<PermissionKey>(), isAdmin: true, isOwner: true };
const staff = (perms: PermissionKey[]) => ({ permissions: new Set(perms), isAdmin: false, isOwner: false });

describe("getAdminNavItems — OWNER/ADMIN", () => {
  it("OWNER sees Overview first and every module", () => {
    const items = getAdminNavItems(t, "en", OWNER) as NavItem[];
    expect(items[0]).toEqual(expect.objectContaining({ label: "navOverview", href: "/admin" }));
    expect(items.map((i) => i.href)).toEqual(
      expect.arrayContaining([
        "/admin/providers", "/admin/reviews", "/admin/customers", "/admin/payments",
        "/admin/email-deliveries", "/admin/users", "/admin/services", "/admin/prices",
        "/admin/availability", "/admin/bookings", "/admin/categories", "/admin/feature-flags", "/admin/homepage-sections",
      ])
    );
  });
});

describe("getAdminNavItems — STAFF (permission-driven)", () => {
  it("a REVIEW_MODERATOR staff sees ONLY Reviews (no Overview, no admin-only modules)", () => {
    const items = getAdminNavItems(t, "en", staff(["reviews.read", "reviews.moderate"])) as NavItem[];
    expect(items.map((i) => i.href)).toEqual(["/admin/reviews"]);
    expect(items.some((i) => i.href === "/admin")).toBe(false);
    expect(items.some((i) => i.href === "/admin/users")).toBe(false);
  });

  it("a staff whose permitted modules are all still admin-only (finance) sees NO nav → no-access", () => {
    expect(getAdminNavItems(t, "en", staff(["finance.read", "finance.manage", "bookings.read"]))).toEqual([]);
  });

  it("a zero-permission staff sees no nav items", () => {
    expect(getAdminNavItems(t, "en", staff([]))).toEqual([]);
  });
});

describe("firstAllowedAdminPath", () => {
  it("returns the first converted module a staff can reach", () => {
    expect(firstAllowedAdminPath(new Set(["reviews.read"]))).toBe("/admin/reviews");
  });
  it("returns null when no converted module is permitted", () => {
    expect(firstAllowedAdminPath(new Set(["finance.read"]))).toBeNull();
    expect(firstAllowedAdminPath(new Set())).toBeNull();
  });
});
