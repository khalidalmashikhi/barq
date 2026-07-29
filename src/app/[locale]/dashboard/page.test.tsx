import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// UX remediation (Admin navigation entry) — regression tests proving:
// (1) an Admin user's rendered nav items include a real "Admin Panel"
// entry pointing at /admin, and (2) a non-admin user's nav items never
// contain it at all — not hidden client-side, genuinely absent from
// the returned tree, since DashboardPage is an async Server Component
// called directly here (the same convention service-filters.test.tsx
// already uses), not rendered through any DOM/testing-library layer.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({}));

const requireAuthMock = vi.fn();
const hasActiveAdminProfileMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  hasActiveAdminProfile: (...args: unknown[]) => hasActiveAdminProfileMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
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

describe("DashboardPage — Admin Panel nav item", () => {
  it("includes a real 'Admin Panel' nav item pointing at /admin for a user with an active Admin profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    hasActiveAdminProfileMock.mockResolvedValue(true);
    getDashboardDataMock.mockResolvedValue(EMPTY_DASHBOARD_DATA);
    getUnreadCountMock.mockResolvedValue(0);

    const element = (await DashboardPage()) as ReactElement<{ navItems: NavItem[] }>;
    const navItems = element.props.navItems;

    const adminItem = navItems.find((item) => item.href === "/admin");
    expect(adminItem).toBeDefined();
    expect(adminItem?.label).toBe("navAdminPanel");
  });

  it("never includes an Admin Panel nav item for a user with no Admin profile", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    hasActiveAdminProfileMock.mockResolvedValue(false);
    getDashboardDataMock.mockResolvedValue(EMPTY_DASHBOARD_DATA);
    getUnreadCountMock.mockResolvedValue(0);

    const element = (await DashboardPage()) as ReactElement<{ navItems: NavItem[] }>;
    const navItems = element.props.navItems;

    expect(navItems.some((item) => item.href === "/admin")).toBe(false);
    expect(navItems.some((item) => item.label === "navAdminPanel")).toBe(false);
  });
});
