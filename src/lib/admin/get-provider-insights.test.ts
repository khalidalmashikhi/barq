import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression tests for getProviderInsights(),
// mirroring get-providers.test.ts's mocking shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getProviderInsights, NO_RECENT_ACTIVITY_WINDOW_DAYS } = await import("./get-provider-insights");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getProviderInsights", () => {
  it("requires an Admin", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviderInsights();

    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("queries providers without any service via a relation `none` filter — no per-provider count query", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviderInsights();

    expect(countMock).toHaveBeenCalledWith({ where: { services: { none: {} } } });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { services: { none: {} } } })
    );
  });

  it("queries providers with no COMPLETED booking via a relation `none` filter scoped to that status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviderInsights();

    expect(countMock).toHaveBeenCalledWith({ where: { bookings: { none: { status: "COMPLETED" } } } });
  });

  it("uses the documented 30-day window and CONFIRMED/IN_PROGRESS/COMPLETED status set for 'no recent activity'", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    const before = Date.now();
    await getProviderInsights();
    const after = Date.now();

    expect(NO_RECENT_ACTIVITY_WINDOW_DAYS).toBe(30);

    const call = countMock.mock.calls.find(
      (args) => (args[0] as { where?: { bookings?: { none?: { updatedAt?: unknown } } } }).where?.bookings?.none?.updatedAt
    );
    expect(call).toBeDefined();
    const where = call![0] as { where: { bookings: { none: { status: { in: string[] }; updatedAt: { gte: Date } } } } };
    expect(where.where.bookings.none.status.in).toEqual(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]);

    const gte = where.where.bookings.none.updatedAt.gte.getTime();
    const expectedMin = before - 30 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 30 * 24 * 60 * 60 * 1000;
    expect(gte).toBeGreaterThanOrEqual(expectedMin - 1000);
    expect(gte).toBeLessThanOrEqual(expectedMax + 1000);
  });

  it("returns real counts and bounded preview items for each insight", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(3);
    findManyMock.mockResolvedValue([{ id: "provider-1", businessName: { en: "Trips Co" }, createdAt: new Date() }]);

    const result = await getProviderInsights();

    expect(result.providersWithoutServicesCount).toBe(3);
    expect(result.providersWithoutServices).toEqual([
      expect.objectContaining({ id: "provider-1", businessName: "Trips Co" }),
    ]);
  });
});
