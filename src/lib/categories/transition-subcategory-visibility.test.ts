import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// setSubCategoryVisibility()/archiveSubCategory(), mirroring
// transition-category-visibility.test.ts's shape.

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

const { setSubCategoryVisibility, archiveSubCategory } = await import("./transition-subcategory-visibility");

const SUBCATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("setSubCategoryVisibility", () => {
  it("updates visibilityStatus and records an audit event for a valid transition", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SUBCATEGORY_ID, visibilityStatus: "HIDDEN" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setSubCategoryVisibility(SUBCATEGORY_ID, "PUBLIC");

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "subcategory.visibility_changed" }),
    });
  });

  it("returns INVALID_VISIBILITY_TRANSITION for an invalid transition", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SUBCATEGORY_ID, visibilityStatus: "ARCHIVED" });

    const result = await setSubCategoryVisibility(SUBCATEGORY_ID, "PUBLIC");

    expect(result).toEqual({ ok: false, error: "INVALID_VISIBILITY_TRANSITION" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("archiveSubCategory", () => {
  it("transitions to ARCHIVED", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: SUBCATEGORY_ID, visibilityStatus: "PUBLIC" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveSubCategory(SUBCATEGORY_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: SUBCATEGORY_ID },
      data: { visibilityStatus: "ARCHIVED", scheduledVisibleAt: null },
    });
  });
});
