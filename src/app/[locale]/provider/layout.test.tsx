import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// Customer → Provider Journey (return path) — the provider shell now exposes a
// "Customer Dashboard" nav item (→ /dashboard) so a user who is both a provider
// and a customer can get back to the customer side. It is a plain nav item, not
// a mode switcher. ProviderLayout is an async Server Component called directly;
// we inspect the AppShell navItems it composes.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("@/i18n/navigation", () => ({
  redirect: vi.fn(),
  getPathname: ({ href }: { href: string }) => href,
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: vi.fn().mockResolvedValue((k: string) => k),
}));
vi.mock("@/lib/notifications/get-unread-count", () => ({
  getUnreadCount: vi.fn().mockResolvedValue(0),
}));

const { default: ProviderLayout } = await import("./layout");

type NavItem = { label: string; href?: string };

afterEach(() => requireProviderMock.mockReset());

describe("ProviderLayout — customer return path", () => {
  it("includes a 'Customer Dashboard' nav item pointing at /dashboard", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });

    const el = (await ProviderLayout({ children: null })) as ReactElement<{ navItems: NavItem[] }>;
    const navItems = el.props.navItems;

    const back = navItems.find((item) => item.href === "/dashboard");
    expect(back).toBeDefined();
    expect(back?.label).toBe("navBackToCustomer");

    // The provider workspace items are still present — this is an addition, not
    // a replacement.
    expect(navItems.some((item) => item.href === "/provider")).toBe(true);
    expect(navItems.some((item) => item.href === "/provider/services")).toBe(true);
  });
});
