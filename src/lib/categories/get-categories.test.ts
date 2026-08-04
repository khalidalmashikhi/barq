import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression test for
// getCategories(), the admin-management list view (every visibility
// status, unlike the future customer-facing Marketplace browsing query
// this phase deliberately does not build). Extended Phase 1.2 (Category
// Admin UI) with search/filter/pagination, so this test now asserts the
// paginated {items, totalCount, page, pageSize, totalPages} shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getCategories } = await import("./get-categories");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getCategories", () => {
  it("requires an Admin and returns a paginated result with effective child visibility", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "category-1",
        name: { ar: "أنشطة", en: "Activities" },
        slug: "activities",
        serviceTypeKey: "EXPERIENCE",
        visibilityStatus: "HIDDEN",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        children: [
          {
            id: "child-1",
            name: { ar: "رحلة صحراوية", en: "Desert Safari" },
            slug: "desert-safari",
            visibilityStatus: "PUBLIC",
          },
        ],
      },
    ]);

    const result = await getCategories();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "category-1",
        name: "Activities",
        serviceTypeKey: "EXPERIENCE",
        visibilityStatus: "HIDDEN",
        children: [
          expect.objectContaining({
            id: "child-1",
            name: "Desert Safari",
            visibilityStatus: "PUBLIC",
            // Parent is HIDDEN, so the child is never effectively visible
            // even though its own status is PUBLIC.
            effectivelyVisible: false,
          }),
        ],
      }),
    ]);
  });

  it("lists only root categories and passes a visibilityStatus filter through to the where clause", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getCategories({ visibilityStatus: "PUBLIC" });

    // parentId: null scopes the list to roots (children nest via the include).
    expect(countMock).toHaveBeenCalledWith({ where: { parentId: null, visibilityStatus: "PUBLIC" } });
  });
});
