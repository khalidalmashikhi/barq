import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { providerCategory: { findMany: (...a: unknown[]) => findManyMock(...a) } },
}));

const { getProviderCategoryIds, getProviderCategoryChips } = await import("./get-provider-categories");

afterEach(() => findManyMock.mockReset());

describe("getProviderCategoryIds", () => {
  it("returns the linked category ids", async () => {
    findManyMock.mockResolvedValue([{ categoryId: "a" }, { categoryId: "b" }]);
    expect(await getProviderCategoryIds("p1")).toEqual(["a", "b"]);
  });
});

describe("getProviderCategoryChips", () => {
  it("resolves labels for effectively-visible categories", async () => {
    findManyMock.mockResolvedValue([
      { category: { id: "a", slug: "diving", name: { en: "Diving" }, sortOrder: 0, visibilityStatus: "PUBLIC", parent: null } },
    ]);
    expect(await getProviderCategoryChips("p1", "en")).toEqual([{ id: "a", slug: "diving", label: "Diving" }]);
  });

  it("drops a category made invisible by a hidden parent (effective visibility)", async () => {
    findManyMock.mockResolvedValue([
      { category: { id: "b", slug: "x", name: { en: "X" }, sortOrder: 0, visibilityStatus: "PUBLIC", parent: { visibilityStatus: "HIDDEN" } } },
    ]);
    expect(await getProviderCategoryChips("p1", "en")).toEqual([]);
  });
});
