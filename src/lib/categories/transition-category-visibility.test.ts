import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// setCategoryVisibility()/archiveCategory(), mirroring
// transition-service-status.test.ts's shape.

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
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

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

const { setCategoryVisibility, archiveCategory, restoreCategory } = await import("./transition-category-visibility");

const CATEGORY_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("setCategoryVisibility", () => {
  it("updates visibilityStatus and records an audit event for a valid transition", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "HIDDEN" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setCategoryVisibility(CATEGORY_ID, "PUBLIC");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "PUBLIC", scheduledVisibleAt: null },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "category.visibility_changed",
        previousValue: { visibilityStatus: "HIDDEN" },
        newValue: { visibilityStatus: "PUBLIC" },
      }),
    });
  });

  it("returns INVALID_VISIBILITY_TRANSITION without mutating anything for an invalid transition", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    // ARCHIVED can restore to PUBLIC/HIDDEN, but not directly to LINK_ONLY.
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });

    const result = await setCategoryVisibility(CATEGORY_ID, "LINK_ONLY");

    expect(result).toEqual({ ok: false, error: "INVALID_VISIBILITY_TRANSITION" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  // Regression: archiving is no longer terminal — an ARCHIVED category can be
  // restored to PUBLIC or PRIVATE (HIDDEN), and the DB update actually runs.
  it("restores an ARCHIVED category to PUBLIC", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setCategoryVisibility(CATEGORY_ID, "PUBLIC");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "PUBLIC", scheduledVisibleAt: null },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "category.visibility_changed",
        previousValue: { visibilityStatus: "ARCHIVED" },
        newValue: { visibilityStatus: "PUBLIC" },
      }),
    });
  });

  it("restores an ARCHIVED category to PRIVATE (HIDDEN)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await setCategoryVisibility(CATEGORY_ID, "HIDDEN");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "HIDDEN", scheduledVisibleAt: null },
    });
  });

  it("returns INVALID_SCHEDULED_DATE when scheduling without a future date", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    const result = await setCategoryVisibility(CATEGORY_ID, "SCHEDULED");

    expect(result).toEqual({ ok: false, error: "INVALID_SCHEDULED_DATE" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns CATEGORY_NOT_FOUND when the category doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await setCategoryVisibility(CATEGORY_ID, "PUBLIC");

    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
  });
});

describe("archiveCategory", () => {
  it("transitions to ARCHIVED and records action category.visibility_changed", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "PUBLIC" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveCategory(CATEGORY_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "ARCHIVED", scheduledVisibleAt: null },
    });
  });
});

describe("restoreCategory", () => {
  it("restores to PUBLIC by default and revalidates the list + detail (refresh)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await restoreCategory(CATEGORY_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "PUBLIC", scheduledVisibleAt: null },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/categories");
    expect(revalidatePathMock).toHaveBeenCalledWith(`/admin/categories/${CATEGORY_ID}`);
  });

  it("restores as HIDDEN when target is HIDDEN", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await restoreCategory(CATEGORY_ID, "HIDDEN");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { visibilityStatus: "HIDDEN", scheduledVisibleAt: null },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/categories");
  });

  it("goes through the shared state machine + audit (records category.visibility_changed)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({ id: CATEGORY_ID, visibilityStatus: "ARCHIVED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await restoreCategory(CATEGORY_ID);

    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "category.visibility_changed",
        previousValue: { visibilityStatus: "ARCHIVED" },
        newValue: { visibilityStatus: "PUBLIC" },
      }),
    });
  });

  it("does not revalidate when the underlying transition fails", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null); // CATEGORY_NOT_FOUND

    const result = await restoreCategory(CATEGORY_ID);

    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
