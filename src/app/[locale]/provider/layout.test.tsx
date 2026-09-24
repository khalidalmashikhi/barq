import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";

// Customer → Provider Journey (return path) — the provider shell now exposes a
// "Customer Dashboard" nav item (→ /dashboard) so a user who is both a provider
// and a customer can get back to the customer side. It is a plain nav item, not
// a mode switcher. ProviderLayout is an async Server Component called directly;
// we inspect the AppShell navItems it composes.
//
// C2d-R1 (correction): the "Vehicle rentals" nav item is gated by the shared
// canViewRentalWorkspace access decision — the SAME decision the pages enforce.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
  // Gate A: the layout redirects an active admin before requireProvider(); a normal
  // provider is not an active admin, so it never redirects.
  isActiveAdminSession: async () => false,
}));

// C2d-R1 — the shared rental-workspace access gate (its own unit test proves the RENTAL_COMPANY
// matrix). Default false so the pre-existing nav tests below (which don't opt in) never see it.
const canViewRentalWorkspaceMock = vi.fn();
vi.mock("@/lib/offerings/rental/provider/rental-workspace-access", () => ({
  canViewRentalWorkspace: (...a: unknown[]) => canViewRentalWorkspaceMock(...a),
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

afterEach(() => {
  requireProviderMock.mockReset();
  canViewRentalWorkspaceMock.mockReset();
});

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

  it("includes a 'My Vehicles' nav item pointing at /provider/vehicles (VEHICLE-2)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });

    const el = (await ProviderLayout({ children: null })) as ReactElement<{ navItems: NavItem[] }>;
    const vehicles = el.props.navItems.find((item) => item.href === "/provider/vehicles");
    expect(vehicles).toBeDefined();
    expect(vehicles?.label).toBe("navVehicles");
  });
});

describe("ProviderLayout — Vehicle rentals nav gating (C2d-R1)", () => {
  async function navItems(): Promise<NavItem[]> {
    const el = (await ProviderLayout({ children: null })) as ReactElement<{ navItems: NavItem[] }>;
    return el.props.navItems;
  }

  it("shows the Vehicle rentals nav item ONLY when the shared access gate allows it", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1", status: "APPROVED" } });
    canViewRentalWorkspaceMock.mockResolvedValue(true);

    const items = await navItems();
    expect(items.find((i) => i.href === "/provider/vehicle-rentals")?.label).toBe("navVehicleRentals");
    // Identity is session-derived (from requireProvider), never client-supplied.
    expect(canViewRentalWorkspaceMock).toHaveBeenCalledWith({ id: "prov-1", status: "APPROVED" });
  });

  it("hides the Vehicle rentals nav item when access is denied (guide-only / unrelated / not a rental company)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1", status: "APPROVED" } });
    canViewRentalWorkspaceMock.mockResolvedValue(false);

    const items = await navItems();
    expect(items.some((i) => i.href === "/provider/vehicle-rentals")).toBe(false);
    // The rest of the workspace is unaffected.
    expect(items.some((i) => i.href === "/provider/vehicles")).toBe(true);
  });

  it("consults the gate once per layout render (bounded — not per nav item)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1", status: "APPROVED" } });
    canViewRentalWorkspaceMock.mockResolvedValue(true);

    await navItems();
    expect(canViewRentalWorkspaceMock).toHaveBeenCalledTimes(1);
  });
});
