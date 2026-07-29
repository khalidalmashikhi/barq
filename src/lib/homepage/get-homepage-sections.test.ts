import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression test for
// getHomepageSections(), mirroring get-feature-flags.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getHomepageSections } = await import("./get-homepage-sections");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getHomepageSections", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "section-1",
        key: "hero_banner",
        label: "Hero Banner",
        description: "Top-of-page hero",
        visible: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await getHomepageSections();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({ key: "hero_banner", visible: true })]);
  });

  it("passes a search filter through to the where clause", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getHomepageSections({ q: "hero" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { key: { contains: "hero", mode: "insensitive" } },
          { label: { contains: "hero", mode: "insensitive" } },
          { description: { contains: "hero", mode: "insensitive" } },
        ],
      },
    });
  });

  it("orders by sortOrder then createdAt", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getHomepageSections();

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    );
  });
});
