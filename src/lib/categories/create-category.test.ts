import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 1.1 (Core Business Platform) — regression tests for
// createCategory(), mirroring create-service.test.ts's shape.

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
const categoryAggregateMock = vi.fn();
const categoryCreateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        category: {
          aggregate: (...args: unknown[]) => categoryAggregateMock(...args),
          create: (...args: unknown[]) => categoryCreateMock(...args),
        },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createCategory } = await import("./create-category");

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
  categoryAggregateMock.mockReset();
  categoryCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("createCategory", () => {
  it("returns INVALID_INPUT for a malformed slug without checking admin status", async () => {
    const result = await createCategory(buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "Not A Slug!" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createCategory(buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities" }));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  it("returns SLUG_TAKEN without creating anything when the slug already exists", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue({ id: "existing-category" });

    const result = await createCategory(buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities" }));

    expect(result).toEqual({ ok: false, error: "SLUG_TAKEN" });
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  it("creates the category HIDDEN by default and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue(null);
    categoryAggregateMock.mockResolvedValue({ _max: { sortOrder: null } });
    categoryCreateMock.mockResolvedValue({ id: "category-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createCategory(buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities" }));

    expect(result).toEqual({ ok: true, categoryId: "category-1" });
    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { name: { ar: "فئة", en: "Category" }, slug: "activities", serviceTypeKey: "EXPERIENCE", sortOrder: 0 },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "category.created",
        entityType: "Category",
        entityId: "category-1",
        newValue: expect.objectContaining({ visibilityStatus: "HIDDEN", serviceTypeKey: "EXPERIENCE" }),
      }),
    });
  });

  it("appends after the existing highest sortOrder rather than always defaulting to 0", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue(null);
    categoryAggregateMock.mockResolvedValue({ _max: { sortOrder: 4 } });
    categoryCreateMock.mockResolvedValue({ id: "category-2" });
    auditCreateMock.mockResolvedValue({});

    await createCategory(buildFormData({ nameAr: "فئة أخرى", nameEn: "Another Category", slug: "another-category" }));

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { name: { ar: "فئة أخرى", en: "Another Category" }, slug: "another-category", serviceTypeKey: "EXPERIENCE", sortOrder: 5 },
    });
  });

  it("persists an explicitly supplied, valid serviceTypeKey (ADR-0015)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue(null);
    categoryAggregateMock.mockResolvedValue({ _max: { sortOrder: null } });
    categoryCreateMock.mockResolvedValue({ id: "category-3" });
    auditCreateMock.mockResolvedValue({});

    await createCategory(buildFormData({ nameAr: "نقل", nameEn: "Transport", slug: "transport", serviceTypeKey: "TRANSPORT" }));

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: "transport", serviceTypeKey: "TRANSPORT" }),
    });
  });

  it("rejects a present-but-invalid serviceTypeKey without creating anything", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    categoryFindUniqueMock.mockResolvedValue(null);

    const result = await createCategory(
      buildFormData({ nameAr: "فئة", nameEn: "Category", slug: "activities", serviceTypeKey: "HOTEL" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });
});
