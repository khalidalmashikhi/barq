import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// updateSubCategory(), mirroring update-category.test.ts's shape.

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

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    subCategory: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        subCategory: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateSubCategory } = await import("./update-subcategory");

const SUBCATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateSubCategory", () => {
  it("returns SUBCATEGORY_NOT_FOUND when the subcategory doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await updateSubCategory(
      SUBCATEGORY_ID,
      buildFormData({ nameAr: "فئة فرعية", nameEn: "Sub", slug: "desert-safari" })
    );

    expect(result).toEqual({ ok: false, error: "SUBCATEGORY_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates name and slug for an existing subcategory", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SUBCATEGORY_ID, name: { ar: "قديم", en: "Old" }, slug: "old-slug" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateSubCategory(
      SUBCATEGORY_ID,
      buildFormData({ nameAr: "جديد", nameEn: "New", slug: "old-slug" })
    );

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: SUBCATEGORY_ID },
      data: { name: { ar: "جديد", en: "New" }, slug: "old-slug" },
    });
  });
});
