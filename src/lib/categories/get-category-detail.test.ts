import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression test for
// getCategoryDetail(), the admin edit-form query — returns raw bilingual
// Json (both languages at once), unlike get-categories.ts's locale-
// extracted list view.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getCategoryDetail } = await import("./get-category-detail");

const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getCategoryDetail", () => {
  it("returns null for a malformed id without querying the database", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    const result = await getCategoryDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the category doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getCategoryDetail(CATEGORY_ID);

    expect(result).toBeNull();
  });

  it("returns both-language name, vertical, parentId, and effective child visibility", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({
      id: CATEGORY_ID,
      name: { ar: "أنشطة", en: "Activities" },
      slug: "activities",
      serviceTypeKey: "EXPERIENCE",
      parentId: null,
      visibilityStatus: "PUBLIC",
      scheduledVisibleAt: null,
      children: [
        {
          id: "child-1",
          name: { ar: "رحلة صحراوية", en: "Desert Safari" },
          slug: "desert-safari",
          visibilityStatus: "PUBLIC",
          scheduledVisibleAt: null,
        },
      ],
    });

    const result = await getCategoryDetail(CATEGORY_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: CATEGORY_ID,
        name: { ar: "أنشطة", en: "Activities" },
        serviceTypeKey: "EXPERIENCE",
        parentId: null,
        visibilityStatus: "PUBLIC",
        children: [
          expect.objectContaining({
            id: "child-1",
            effectivelyVisible: true,
          }),
        ],
      })
    );
  });
});
