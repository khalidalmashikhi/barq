import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.3 (Core Business Platform) — regression test for
// getFeatureFlags(), mirroring get-categories.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    featureFlag: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getFeatureFlags } = await import("./get-feature-flags");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getFeatureFlags", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "flag-1",
        key: "new_checkout_flow",
        enabled: true,
        description: "Gates the redesigned checkout",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await getFeatureFlags();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({ key: "new_checkout_flow", enabled: true })]);
  });

  it("passes a search filter through to the where clause", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getFeatureFlags({ q: "checkout" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { key: { contains: "checkout", mode: "insensitive" } },
          { description: { contains: "checkout", mode: "insensitive" } },
        ],
      },
    });
  });
});
