import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.4 (Core Business Platform) — regression tests for
// moveHomepageSectionUp()/moveHomepageSectionDown(), mirroring
// reorder-category.test.ts's shape exactly.

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

const findManyMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    homepageSection: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        homepageSection: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { moveHomepageSectionUp, moveHomepageSectionDown } = await import("./reorder-homepage-section");

const ORDERED = [
  { id: "019f4e4e-8116-7052-b15e-000000000001", sortOrder: 0 },
  { id: "019f4e4e-8116-7052-b15e-000000000002", sortOrder: 1 },
  { id: "019f4e4e-8116-7052-b15e-000000000003", sortOrder: 2 },
];

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("moveHomepageSectionUp", () => {
  it("swaps sortOrder with the previous sibling", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await moveHomepageSectionUp("019f4e4e-8116-7052-b15e-000000000002");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000002" }, data: { sortOrder: 0 } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000001" }, data: { sortOrder: 1 } });
  });

  it("is a no-op at the top of the list", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue(ORDERED);

    const result = await moveHomepageSectionUp("019f4e4e-8116-7052-b15e-000000000001");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns SECTION_NOT_FOUND for an id not in the list", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue(ORDERED);

    const result = await moveHomepageSectionUp("019f4e4e-8116-7052-b15e-000000000099");

    expect(result).toEqual({ ok: false, error: "SECTION_NOT_FOUND" });
  });
});

describe("moveHomepageSectionDown", () => {
  it("swaps sortOrder with the next sibling", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue(ORDERED);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await moveHomepageSectionDown("019f4e4e-8116-7052-b15e-000000000002");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000002" }, data: { sortOrder: 2 } });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "019f4e4e-8116-7052-b15e-000000000003" }, data: { sortOrder: 1 } });
  });

  it("is a no-op at the bottom of the list", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findManyMock.mockResolvedValue(ORDERED);

    const result = await moveHomepageSectionDown("019f4e4e-8116-7052-b15e-000000000003");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
