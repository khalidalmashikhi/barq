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

  it("a PROVIDER_VERIFICATION staff sees Providers + Vehicles (both providers.read)", () => {
    const items = getAdminNavItems(t, "en", staff(["providers.read", "providers.review", "providerDocuments.read"])) as NavItem[];
    expect(items.map((i) => i.href)).toEqual(["/admin/providers", "/admin/vehicles"]);
    expect(items.some((i) => i.href === "/admin/reviews")).toBe(false);
    expect(items.some((i) => i.href === "/admin")).toBe(false);
  });

  it("a FINANCE staff sees Prices + Payments + Bookings (finance.read + bookings.read), never privilege/content", () => {
    const items = getAdminNavItems(t, "en", staff(["finance.read", "finance.manage", "bookings.read"])) as NavItem[];
    expect(items.map((i) => i.href)).toEqual(
      expect.arrayContaining(["/admin/prices", "/admin/payments", "/admin/bookings", "/admin/availability", "/admin/email-deliveries"])
    );
    expect(items.some((i) => i.href === "/admin/users")).toBe(false);
    expect(items.some((i) => i.href === "/admin/staff")).toBe(false);
    expect(items.some((i) => i.href === "/admin/categories")).toBe(false);
    expect(items.some((i) => i.href === "/admin")).toBe(false);
  });

  it("a BOOKING_OPS staff sees booking surfaces + Providers/Vehicles, not finance/content/users", () => {
    const items = getAdminNavItems(t, "en", staff(["bookings.read", "bookings.manage", "providers.read"])) as NavItem[];
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/bookings", "/admin/availability", "/admin/email-deliveries", "/admin/providers", "/admin/vehicles"]));
    expect(hrefs).not.toContain("/admin/prices");
    expect(hrefs).not.toContain("/admin/customers");
    expect(hrefs).not.toContain("/admin/categories");
    expect(hrefs).not.toContain("/admin/staff");
  });

  it("a CONTENT_MANAGER staff sees Services/Categories/Homepage, not bookings/finance/users", () => {
    const items = getAdminNavItems(t, "en", staff(["content.read", "content.manage"])) as NavItem[];
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/services", "/admin/categories", "/admin/homepage-sections"]));
    expect(hrefs).not.toContain("/admin/bookings");
    expect(hrefs).not.toContain("/admin/prices");
    expect(hrefs).not.toContain("/admin/users");
  });

  it("a zero-permission staff sees no nav items", () => {
    expect(getAdminNavItems(t, "en", staff([]))).toEqual([]);
  });
});

describe("firstAllowedAdminPath", () => {
  it("returns the first converted module a staff can reach (nav order)", () => {
    expect(firstAllowedAdminPath(new Set(["reviews.read"]))).toBe("/admin/reviews");
    expect(firstAllowedAdminPath(new Set(["finance.read"]))).toBe("/admin/prices");
    expect(firstAllowedAdminPath(new Set(["bookings.read"]))).toBe("/admin/bookings");
    expect(firstAllowedAdminPath(new Set(["content.read"]))).toBe("/admin/services");
    expect(firstAllowedAdminPath(new Set(["users.read"]))).toBe("/admin/customers");
    expect(firstAllowedAdminPath(new Set(["settings.manage"]))).toBe("/admin/feature-flags");
    // providers.read is first in nav order → wins when multiple are held
    expect(firstAllowedAdminPath(new Set(["reviews.read", "providers.read"]))).toBe("/admin/providers");
  });
  it("returns null when no module-backed permission is held (e.g. only providerDocuments.read/audit.read)", () => {
    expect(firstAllowedAdminPath(new Set(["providerDocuments.read"]))).toBeNull();
    expect(firstAllowedAdminPath(new Set(["audit.read"]))).toBeNull();
    expect(firstAllowedAdminPath(new Set())).toBeNull();
  });
});
