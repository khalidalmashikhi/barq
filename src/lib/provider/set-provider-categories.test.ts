import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/service-types", () => ({ DEFAULT_SERVICE_TYPE_KEY: "EXPERIENCE" }));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const assertAssignableCategoryMock = vi.fn();
vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...a: unknown[]) => assertAssignableCategoryMock(...a),
}));

const findManyMock = vi.fn();
const deleteManyMock = vi.fn();
const createManyMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerCategory: {
          findMany: (...a: unknown[]) => findManyMock(...a),
          deleteMany: (...a: unknown[]) => deleteManyMock(...a),
          createMany: (...a: unknown[]) => createManyMock(...a),
        },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { setProviderCategories } = await import("./set-provider-categories");

function fd(ids: string[]): FormData {
  const f = new FormData();
  for (const id of ids) f.append("categoryIds", id);
  return f;
}

afterEach(() => {
  requireProviderMock.mockReset();
  assertAssignableCategoryMock.mockReset();
  findManyMock.mockReset();
  deleteManyMock.mockReset();
  createManyMock.mockReset();
  auditCreateMock.mockReset();
});

describe("setProviderCategories", () => {
  it("replaces the set (deduped) and audits when all ids are assignable", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    assertAssignableCategoryMock.mockResolvedValue(true);
    findManyMock.mockResolvedValue([{ categoryId: "old" }]);
    deleteManyMock.mockResolvedValue({});
    createManyMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setProviderCategories(fd(["c1", "c2", "c1"]));

    expect(result).toEqual({ ok: true });
    expect(assertAssignableCategoryMock).toHaveBeenCalledWith("c1", "EXPERIENCE");
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { providerId: "p1" } });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        { providerId: "p1", categoryId: "c1", source: "SELF" },
        { providerId: "p1", categoryId: "c2", source: "SELF" },
      ],
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "provider.categories_changed",
        previousValue: { categoryIds: ["old"] },
        newValue: { categoryIds: ["c1", "c2"] },
      }),
    });
  });

  it("rejects an unassignable id with INVALID_CATEGORY and mutates nothing", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    assertAssignableCategoryMock.mockResolvedValue(false);

    const result = await setProviderCategories(fd(["bad"]));

    expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("clears all areas (delete, no create) when none are submitted", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    findManyMock.mockResolvedValue([{ categoryId: "old" }]);
    deleteManyMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setProviderCategories(fd([]));

    expect(result).toEqual({ ok: true });
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { providerId: "p1" } });
    expect(createManyMock).not.toHaveBeenCalled();
  });
});
