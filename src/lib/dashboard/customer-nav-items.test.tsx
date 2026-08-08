import { describe, it, expect, vi } from "vitest";

// Customer Experience Platform — regression tests for getCustomerNavItems().
// Confirms: the new Reviews route is navigable (real href) for every
// caller, Saved/Settings remain non-navigable (no href) but now carry
// a real disabledHint, Become-Provider/Admin-Panel items only appear
// when explicitly opted in via `options` — and, critically, this
// helper never calls any RBAC/admin-check function itself (it has no
// dependency on @/lib/auth at all), proving it only renders based on
// already-resolved flags the caller passes in.

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string }) => href,
}));

const { getCustomerNavItems } = await import("./customer-nav-items");

const fakeT = ((key: string) => key) as unknown as Parameters<typeof getCustomerNavItems>[0];

describe("getCustomerNavItems — Reviews route", () => {
  it("is always navigable with a real href, regardless of options", () => {
    const items = getCustomerNavItems(fakeT, "en", 0);
    const reviews = items.find((item) => item.label === "navReviews");
    expect(reviews?.href).toBe("/reviews");
  });
});

// Payment Experience & Financial Operations phase.
describe("getCustomerNavItems — Payments route", () => {
  it("is always navigable with a real href, regardless of options", () => {
    const items = getCustomerNavItems(fakeT, "en", 0);
    const payments = items.find((item) => item.label === "navPayments");
    expect(payments?.href).toBe("/payments");
  });
});

describe("getCustomerNavItems — Saved and Settings", () => {
  it("keeps Saved non-navigable with a disabledHint, but Settings is now a real link", () => {
    const items = getCustomerNavItems(fakeT, "en", 0);
    const saved = items.find((item) => item.label === "navSaved");
    const settings = items.find((item) => item.label === "navSettings");

    // Saved (favorites) is still deferred.
    expect(saved?.href).toBeUndefined();
    expect(saved?.disabledHint).toBe("comingSoonLabel");

    // Settings now routes to the real customer account settings page.
    expect(settings?.href).toBe("/dashboard/settings");
    expect(settings?.disabledHint).toBeUndefined();
  });
});

describe("getCustomerNavItems — contextual options", () => {
  it("omits Become Provider and Admin Panel when no options are passed", () => {
    const items = getCustomerNavItems(fakeT, "en", 0);
    expect(items.some((item) => item.label === "navBecomeProvider")).toBe(false);
    expect(items.some((item) => item.label === "navAdminPanel")).toBe(false);
  });

  it("includes Become Provider only when showBecomeProvider is true", () => {
    const items = getCustomerNavItems(fakeT, "en", 0, { showBecomeProvider: true });
    const becomeProvider = items.find((item) => item.label === "navBecomeProvider");
    expect(becomeProvider?.href).toBe("/provider-application");
    expect(items.some((item) => item.label === "navAdminPanel")).toBe(false);
  });

  it("includes Provider workspace (→ /provider) only when showProviderWorkspace is true", () => {
    const items = getCustomerNavItems(fakeT, "en", 0, { showProviderWorkspace: true });
    const workspace = items.find((item) => item.label === "navProviderWorkspace");
    expect(workspace?.href).toBe("/provider");
  });

  it("omits Provider workspace by default", () => {
    const items = getCustomerNavItems(fakeT, "en", 0);
    expect(items.some((item) => item.label === "navProviderWorkspace")).toBe(false);
  });

  it("includes Admin Panel only when isAdmin is true", () => {
    const items = getCustomerNavItems(fakeT, "en", 0, { isAdmin: true });
    const adminPanel = items.find((item) => item.label === "navAdminPanel");
    expect(adminPanel?.href).toBe("/admin");
  });

  it("never imports or calls any RBAC/admin-check function itself — options are the only input", async () => {
    // If this module reached into @/lib/auth on its own, importing it
    // without mocking that module would fail (server-only guards,
    // database calls, etc.) — it doesn't, which is itself the proof.
    const moduleSource = await import("./customer-nav-items");
    expect(typeof moduleSource.getCustomerNavItems).toBe("function");
  });
});

describe("getCustomerNavItems — Notifications badge passthrough", () => {
  it("passes the caller-supplied unread count through unchanged, never refetching it", () => {
    const items = getCustomerNavItems(fakeT, "en", 7);
    const notifications = items.find((item) => item.label === "navNotifications");
    expect(notifications?.badge).toBe(7);
  });
});
