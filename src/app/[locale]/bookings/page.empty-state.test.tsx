import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { EmptyState } from "@/components/ui/empty-state";

// `server-only` throws when imported outside Next.js's own build
// pipeline, which has no equivalent marker under Vitest.
vi.mock("server-only", () => ({}));

// next-intl's react-server navigation build re-exports from
// `next/navigation` via a package export condition only Next.js's
// bundler sets, so it can't resolve under Vitest either. Mocked here
// with this app's actual routing behavior (`localePrefix: "always"`,
// no custom pathnames): prefix `href` with `/${locale}`.
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ user: { id: "test-user-id" } }),
  requireAuth: async () => ({ barqUser: { id: "test-user-id" } }),
}));

vi.mock("@/lib/booking/get-my-bookings", () => ({
  getMyBookings: async () => ({ items: [], totalCount: 0, page: 1, totalPages: 1 }),
}));

// Phase D.1 — bookings/page.tsx now also fetches the real unread
// notification count for its AppShell badge; mocked here the same way
// getMyBookings already is, so this test stays scoped to the
// empty-state action link it actually verifies.
vi.mock("@/lib/notifications/get-unread-count", () => ({
  getUnreadCount: async () => 0,
}));

// Customer → Provider Journey (A) — bookings/page.tsx now also resolves the
// provider-doorway/admin nav flags via this shared resolver; mocked here (same
// as getMyBookings/getUnreadCount) so this test stays scoped to the empty-state
// link it verifies. Its own logic is covered by resolve-customer-nav-options.test.ts.
vi.mock("@/lib/dashboard/resolve-customer-nav-options", () => ({
  resolveCustomerNavOptions: async () => ({ providerDoorway: "become", isAdmin: false }),
}));

vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

const { default: BookingsPage } = await import("./page");

function findEmptyStateAction(element: unknown): ReactElement | undefined {
  if (!element || typeof element !== "object") return undefined;
  const el = element as ReactElement<{ children?: unknown }>;
  if (el.type === EmptyState) {
    return (el.props as { action?: ReactElement }).action;
  }
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findEmptyStateAction(child);
      if (found) return found;
    }
  } else if (children) {
    return findEmptyStateAction(children);
  }
  return undefined;
}

describe("BookingsPage empty-state Browse Experiences link", () => {
  it("resolves to /ar/services for the Arabic locale", async () => {
    getLocaleMock.mockResolvedValue("ar");
    const element = await BookingsPage({ searchParams: Promise.resolve({}) });
    const action = findEmptyStateAction(element);
    expect(action).toBeDefined();
    expect((action!.props as { href?: string }).href).toBe("/ar/services");
  });

  it("resolves to /en/services for the English locale", async () => {
    getLocaleMock.mockResolvedValue("en");
    const element = await BookingsPage({ searchParams: Promise.resolve({}) });
    const action = findEmptyStateAction(element);
    expect(action).toBeDefined();
    expect((action!.props as { href?: string }).href).toBe("/en/services");
  });
});
