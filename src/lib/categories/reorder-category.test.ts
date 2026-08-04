import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.2 (Category Admin UI) — regression tests for
// moveCategoryUp()/moveCategoryDown(), the sortOrder-swap ordering mechanism.
// Extended for the tree (ADR-0015): reordering is scoped to the node's own
// sibling group (same parentId), so the action first looks up the target's
// parentId, then swaps within siblings only — roots never mix with children.

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
    category: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        category: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { moveCategoryUp, moveCategoryDown } = await import("./reorder-category");

const ORDERED = [
  { id: "019f4e4e-8116-7052-b15e-000000000001", sortOrder: 0 },
  { id: "019f4e4e-8116-7052-b15e-000000000002", sortOrder: 1 },
  { id: "019f4e4e-8116-7052-b15e-000000000003", sortOrder: 2 },
];

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("moveCategoryUp", () => {
  it("swaps sortOrder with the previous sibling", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: null });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await moveCategoryUp("019f4e4e-8116-7052-b15e-000000000002");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000002" }, data: { sortOrder: 0 } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000001" }, data: { sortOrder: 1 } });
  });

  it("scopes the sibling lookup to the target's parentId (root -> parentId null)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: null });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await moveCategoryUp("019f4e4e-8116-7052-b15e-000000000002");

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { parentId: null } }));
  });

  it("scopes the sibling lookup to the target's parentId (child -> parent id)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: "019f4e4e-8116-7052-b15e-0000000000aa" });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await moveCategoryUp("019f4e4e-8116-7052-b15e-000000000002");

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: "019f4e4e-8116-7052-b15e-0000000000aa" } })
    );
  });

  it("is a no-op at the top of the sibling group", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: null });
    findManyMock.mockResolvedValue(ORDERED);

    const result = await moveCategoryUp("019f4e4e-8116-7052-b15e-000000000001");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns CATEGORY_NOT_FOUND when the target does not exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await moveCategoryUp("019f4e4e-8116-7052-b15e-000000000099");

    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("moveCategoryDown", () => {
  it("swaps sortOrder with the next sibling", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: null });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await moveCategoryDown("019f4e4e-8116-7052-b15e-000000000002");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000002" }, data: { sortOrder: 2 } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000003" }, data: { sortOrder: 1 } });
  });

  it("is a no-op at the bottom of the sibling group", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ parentId: null });
    findManyMock.mockResolvedValue(ORDERED);

    const result = await moveCategoryDown("019f4e4e-8116-7052-b15e-000000000003");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
