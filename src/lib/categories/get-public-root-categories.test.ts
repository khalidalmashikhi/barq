import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { category: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const { getPublicRootCategories } = await import("./get-public-root-categories");
const { publicCategoryWhere } = await import("./public-category-rule");

afterEach(() => findManyMock.mockReset());

describe("getPublicRootCategories", () => {
  it("queries PUBLIC roots (shared rule + parentId null), ordered by sortOrder, capped", async () => {
    findManyMock.mockResolvedValue([]);
    await getPublicRootCategories();
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...publicCategoryWhere(), parentId: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 12,
      })
    );
  });

  it("resolves localized labels, falling back to slug when empty", async () => {
    findManyMock.mockResolvedValue([
      { id: "a", slug: "diving", name: { en: "Diving" } },
      { id: "b", slug: "hiking", name: {} },
    ]);
    expect(await getPublicRootCategories()).toEqual([
      { id: "a", slug: "diving", label: "Diving" },
      { id: "b", slug: "hiking", label: "hiking" },
    ]);
  });
});
