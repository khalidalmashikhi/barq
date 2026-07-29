import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.2 (Category Admin UI) — regression tests for
// moveSubCategoryUp()/moveSubCategoryDown(), mirroring
// reorder-category.test.ts's shape, scoped to siblings under one parent.

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
const findManyMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    subCategory: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        subCategory: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { moveSubCategoryUp, moveSubCategoryDown } = await import("./reorder-subcategory");

const SIBLINGS = [
  { id: "019f4e4e-8116-7052-b15e-000000000011", sortOrder: 0 },
  { id: "019f4e4e-8116-7052-b15e-000000000012", sortOrder: 1 },
];

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("moveSubCategoryUp / moveSubCategoryDown", () => {
  it("returns SUBCATEGORY_NOT_FOUND when the subcategory doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await moveSubCategoryUp("019f4e4e-8116-7052-b15e-000000000099");

    expect(result).toEqual({ ok: false, error: "SUBCATEGORY_NOT_FOUND" });
  });

  it("swaps sortOrder with the next sibling under the same parent", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "019f4e4e-8116-7052-b15e-000000000011", categoryId: "019f4e4e-8116-7052-b15e-000000000001" });
    findManyMock.mockResolvedValue(SIBLINGS);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await moveSubCategoryDown("019f4e4e-8116-7052-b15e-000000000011");

    expect(result).toEqual({ ok: true });
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { categoryId: "019f4e4e-8116-7052-b15e-000000000001" } }));
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000011" }, data: { sortOrder: 1 } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000012" }, data: { sortOrder: 0 } });
  });

  it("is a no-op at the top of the list", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: "019f4e4e-8116-7052-b15e-000000000011", categoryId: "019f4e4e-8116-7052-b15e-000000000001" });
    findManyMock.mockResolvedValue(SIBLINGS);

    const result = await moveSubCategoryUp("019f4e4e-8116-7052-b15e-000000000011");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
