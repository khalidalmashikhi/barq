import { describe, it, expect, vi, afterEach } from "vitest";

// Unified Preview System — getCategoryPreview(): admin-gated read that reuses
// the existing isCategoryEffectivelyVisible policy (a PUBLIC child under a
// non-PUBLIC parent is NOT effectively visible) and returns only fields the
// Category model actually has (no description/icon invented).

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn().mockResolvedValue({});
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));

const categoryFindUniqueMock = vi.fn();
const serviceCountMock = vi.fn();
const categoryCountMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: (...a: unknown[]) => categoryFindUniqueMock(...a),
      count: (...a: unknown[]) => categoryCountMock(...a),
    },
    service: { count: (...a: unknown[]) => serviceCountMock(...a) },
  },
}));

const { getCategoryPreview } = await import("./get-category-preview");

const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  categoryFindUniqueMock.mockReset();
  serviceCountMock.mockReset();
  categoryCountMock.mockReset();
});

describe("getCategoryPreview", () => {
  it("reports effectively-visible for a PUBLIC root with no parent, plus counts", async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: CATEGORY_ID,
      name: { en: "Tours", ar: "جولات" },
      slug: "tours",
      parentId: null,
      parent: null,
      visibilityStatus: "PUBLIC",
      scheduledVisibleAt: null,
      sortOrder: 0,
    });
    serviceCountMock.mockResolvedValue(4);
    categoryCountMock.mockResolvedValue(6);

    const result = await getCategoryPreview(CATEGORY_ID);

    expect(result).toMatchObject({
      slug: "tours",
      visibilityStatus: "PUBLIC",
      effectivelyVisible: true,
      parent: null,
      linkedPublishedServiceCount: 4,
      sortOrder: 0,
      siblingCount: 6,
    });
  });

  it("reports NOT effectively-visible for a PUBLIC child under a HIDDEN parent (reuses the policy)", async () => {
    categoryFindUniqueMock.mockResolvedValue({
      id: CATEGORY_ID,
      name: { en: "Diving", ar: "غوص" },
      slug: "diving",
      parentId: "parent-1",
      parent: { name: { en: "Water", ar: "ماء" }, slug: "water", visibilityStatus: "HIDDEN" },
      visibilityStatus: "PUBLIC",
      scheduledVisibleAt: null,
      sortOrder: 2,
    });
    serviceCountMock.mockResolvedValue(0);
    categoryCountMock.mockResolvedValue(3);

    const result = await getCategoryPreview(CATEGORY_ID);

    expect(result?.effectivelyVisible).toBe(false);
    expect(result?.parent).toMatchObject({ slug: "water", visibilityStatus: "HIDDEN" });
  });

  it("returns null for a malformed id", async () => {
    expect(await getCategoryPreview("not-a-uuid")).toBeNull();
    expect(categoryFindUniqueMock).not.toHaveBeenCalled();
  });
});
