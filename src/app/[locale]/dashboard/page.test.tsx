import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// Admin Backoffice Hardening (Gate A) — updated regression tests proving:
// (1) an ACTIVE Admin is REDIRECTED away from the customer dashboard to /admin
// (backoffice-only) before any customer loader runs — the old "Admin Panel nav
// item for an admin" behavior is gone precisely because an active admin never
// renders this page anymore; (2) a non-admin's nav items never contain an Admin
// Panel entry — genuinely absent from the returned tree, since DashboardPage is an
// async Server Component called directly here (the same convention
// service-filters.test.tsx uses), not rendered through any DOM layer.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({}));

const requireAuthMock = vi.fn();
const hasActiveAdminProfileMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  hasActiveAdminProfile: (...args: unknown[]) => hasActiveAdminProfileMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

// Customer → Provider Journey (A) — the provider-doorway/admin flags now come
// from the shared resolver, mocked here so these tests drive the page's nav
// composition directly (the resolver's own logic is covered by
// resolve-customer-nav-options.test.ts).
const resolveCustomerNavOptionsMock = vi.fn();

vi.mock("@/lib/dashboard/resolve-customer-nav-options", () => ({
  resolveCustomerNavOptions: (...args: unknown[]) => resolveCustomerNavOptionsMock(...args),
}));

const getDashboardDataMock = vi.fn();

vi.mock("@/lib/dashboard/get-dashboard-data", () => ({
  getDashboardData: (...args: unknown[]) => getDashboardDataMock(...args),
}));

const getUnreadCountMock = vi.fn();

vi.mock("@/lib/notifications/get-unread-count", () => ({
  getUnreadCount: (...args: unknown[]) => getUnreadCountMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  getPathname: ({ href }: { href: string }) => href,
}));

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

const { default: DashboardPage } = await import("./page");

type NavItem = { label: string; href?: string };

afterEach(() => {
  requireAuthMock.mockReset();
  hasActiveAdminProfileMock.mockReset();
  resolveCustomerNavOptionsMock.mockReset();
  getDashboardDataMock.mockReset();
  getUnreadCountMock.mockReset();
});

const EMPTY_DASHBOARD_DATA = {
  hasCustomerProfile: true,
  activeBookingsCount: 0,
  upcomingBookingsCount: 0,
  notificationsCount: 0,
  upcomingBookings: [],
  featuredServices: [],
  mostBookedServices: [],
  bookingStatusCounts: { total: 0, active: 0, completed: 0, cancelled: 0 },
  reviewsGivenCount: 0,
  awaitingReviewCount: 0,
  recentBookings: [],
};

describe("DashboardPage — nav composition from resolveCustomerNavOptions", () => {
  it("Gate A: redirects an ACTIVE admin to /admin before any customer loader runs (backoffice-only)", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "admin-user" } });
    hasActiveAdminProfileMock.mockResolvedValue(true);
    getDashboardDataMock.mockResolvedValue(EMPTY_DASHBOARD_DATA);
    getUnreadCountMock.mockResolvedValue(0);

    // The mocked locale-aware redirect throws NEXT_REDIRECT, so the page never
    // returns a nav tree — and, crucially, no customer data is ever loaded.
    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getDashboardDataMock).not.toHaveBeenCalled();
    expect(resolveCustomerNavOptionsMock).not.toHaveBeenCalled();
  });

  it("never includes an Admin Panel nav item for a user with no Admin profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    hasActiveAdminProfileMock.mockResolvedValue(false);
    resolveCustomerNavOptionsMock.mockResolvedValue({ providerDoorway: "become", isAdmin: false });
    getDashboardDataMock.mockResolvedValue(EMPTY_DASHBOARD_DATA);
    getUnreadCountMock.mockResolvedValue(0);

    const element = (await DashboardPage()) as ReactElement<{ navItems: NavItem[] }>;
    const navItems = element.props.navItems;

    expect(navItems.some((item) => item.href === "/admin")).toBe(false);
    expect(navItems.some((item) => item.label === "navAdminPanel")).toBe(false);
  });

  it("exposes the Provider workspace doorway (→ /provider) for an approved provider", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    hasActiveAdminProfileMock.mockResolvedValue(false);
    resolveCustomerNavOptionsMock.mockResolvedValue({ providerDoorway: "workspace", isAdmin: false });
    getDashboardDataMock.mockResolvedValue(EMPTY_DASHBOARD_DATA);
    getUnreadCountMock.mockResolvedValue(0);

    const element = (await DashboardPage()) as ReactElement<{ navItems: NavItem[] }>;
    const navItems = element.props.navItems;

    const workspace = navItems.find((item) => item.href === "/provider");
    expect(workspace?.label).toBe("navProviderWorkspace");
    // Customer capabilities remain: the core customer items are still present.
    expect(navItems.some((item) => item.href === "/bookings")).toBe(true);
  });
});
