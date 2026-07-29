import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// createSubCategory(), mirroring create-category.test.ts's shape with an
// added parent-existence check.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const categoryFindUniqueMock = vi.fn();
const subCategoryFindUniqueMock = vi.fn();
const subCategoryAggregateMock = vi.fn();
const subCategoryCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args),
    },
    subCategory: {
      findUnique: (...args: unknown[]) => subCategoryFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        subCategory: {
          aggregate: (...args: unknown[]) => subCategoryAggregateMock(...args),
          create: (...args: unknown[]) => subCategoryCreateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createSubCategory } = await import("./create-subcategory");

const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  categoryFindUniqueMock.mockReset();
  subCategoryFindUniqueMock.mockReset();
  subCategoryAggregateMock.mockReset();
  subCategoryCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createSubCategory", () => {
  it("returns INVALID_INPUT for a malformed category id without checking admin status", async () => {
    const result = await createSubCategory("not-a-uuid", buildFormData({ nameAr: "فئة فرعية", nameEn: "Sub", slug: "desert-safari" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns CATEGORY_NOT_FOUND when the parent category doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue(null);

    const result = await createSubCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "فئة فرعية", nameEn: "Sub", slug: "desert-safari" })
    );

    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(subCategoryCreateMock).not.toHaveBeenCalled();
  });

  it("creates the subcategory HIDDEN by default under its parent", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue({ id: CATEGORY_ID });
    subCategoryFindUniqueMock.mockResolvedValue(null);
    subCategoryAggregateMock.mockResolvedValue({ _max: { sortOrder: null } });
    subCategoryCreateMock.mockResolvedValue({ id: "subcategory-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createSubCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "رحلة صحراوية", nameEn: "Desert Safari", slug: "desert-safari" })
    );

    expect(result).toEqual({ ok: true, subCategoryId: "subcategory-1" });
    expect(subCategoryCreateMock).toHaveBeenCalledWith({
      data: { categoryId: CATEGORY_ID, name: { ar: "رحلة صحراوية", en: "Desert Safari" }, slug: "desert-safari", sortOrder: 0 },
    });
  });

  it("appends after the existing highest sortOrder among siblings under the same parent", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue({ id: CATEGORY_ID });
    subCategoryFindUniqueMock.mockResolvedValue(null);
    subCategoryAggregateMock.mockResolvedValue({ _max: { sortOrder: 2 } });
    subCategoryCreateMock.mockResolvedValue({ id: "subcategory-2" });
    auditCreateMock.mockResolvedValue({});

    await createSubCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "جولة جبلية", nameEn: "Mountain Tour", slug: "mountain-tour" })
    );

    expect(subCategoryAggregateMock).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID }, _max: { sortOrder: true } });
    expect(subCategoryCreateMock).toHaveBeenCalledWith({
      data: { categoryId: CATEGORY_ID, name: { ar: "جولة جبلية", en: "Mountain Tour" }, slug: "mountain-tour", sortOrder: 3 },
    });
  });
});
