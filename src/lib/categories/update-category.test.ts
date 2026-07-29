import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// updateCategory(), mirroring update-service.test.ts's shape.

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
    category: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        category: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { updateCategory } = await import("./update-category");

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
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateCategory", () => {
  it("returns INVALID_INPUT for a malformed category id without checking admin status", async () => {
    const result = await updateCategory("not-a-uuid", buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns CATEGORY_NOT_FOUND when the category doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await updateCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities" })
    );

    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates name and slug for an existing category", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValueOnce({ id: CATEGORY_ID, name: { ar: "قديم", en: "Old" }, slug: "old-slug" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "جديد", nameEn: "New", slug: "old-slug" })
    );

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { name: { ar: "جديد", en: "New" }, slug: "old-slug" },
    });
  });

  it("returns SLUG_TAKEN when renaming to a slug another category already owns", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValueOnce({ id: CATEGORY_ID, name: { ar: "قديم", en: "Old" }, slug: "old-slug" });
    findUniqueMock.mockResolvedValueOnce({ id: "other-category" });

    const result = await updateCategory(
      CATEGORY_ID,
      buildFormData({ nameAr: "جديد", nameEn: "New", slug: "taken-slug" })
    );

    expect(result).toEqual({ ok: false, error: "SLUG_TAKEN" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
