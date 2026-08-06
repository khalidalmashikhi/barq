import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.3 (Service Foundation) — regression tests for createService(),
// the admin-initiated direct creation path, distinct from the
// pre-existing self-service src/lib/provider/create-service.ts flow.

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

const providerFindUniqueMock = vi.fn();
const serviceCreateMock = vi.fn();
const auditCreateMock = vi.fn();
const assertAssignableCategoryMock = vi.fn();

vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...args: unknown[]) => assertAssignableCategoryMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { create: (...args: unknown[]) => serviceCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

const { createService } = await import("./create-service");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function baseFields(overrides: Record<string, string> = {}) {
  return {
    providerId: PROVIDER_ID,
    nameAr: "جولة الصحراء",
    nameEn: "Desert Tour",
    descriptionAr: "",
    descriptionEn: "",
    ...overrides,
  };
}

afterEach(() => {
  requireAdminMock.mockReset();
  providerFindUniqueMock.mockReset();
  serviceCreateMock.mockReset();
  auditCreateMock.mockReset();
  assertAssignableCategoryMock.mockReset();
});

describe("createService", () => {
  it("returns INVALID_INPUT for a malformed providerId without checking admin status", async () => {
    const result = await createService(buildFormData(baseFields({ providerId: "not-a-uuid" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a blank name", async () => {
    const result = await createService(buildFormData(baseFields({ nameAr: "  ", nameEn: "" })));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("returns NO_ADMIN_PROFILE when the caller has no Admin profile", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new ForbiddenError("Admin role required"));

    const result = await createService(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_FOUND when the target provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue(null);

    const result = await createService(buildFormData(baseFields()));

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_FOUND" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("creates the service as EXPERIENCE with no price and records an audit event", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createService(buildFormData(baseFields()));

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(serviceCreateMock).toHaveBeenCalledWith({
      data: {
        providerId: PROVIDER_ID,
        serviceType: "EXPERIENCE",
        name: { ar: "جولة الصحراء", en: "Desert Tour" },
        description: undefined,
      },
    });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "ADMIN",
        actorId: "admin-1",
        action: "service.created",
        entityType: "Service",
        entityId: "service-1",
        newValue: expect.objectContaining({ status: "DRAFT" }),
      }),
    });
  });

  it("assigns a valid category on create and records a category_assigned audit alongside service.created", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID });
    assertAssignableCategoryMock.mockResolvedValue(true);
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    auditCreateMock.mockResolvedValue({});

    const result = await createService(buildFormData(baseFields({ categoryId: "cat-1" })));

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(assertAssignableCategoryMock).toHaveBeenCalledWith("cat-1", "EXPERIENCE");
    expect(serviceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-1" }) })
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "service.category_assigned",
        previousValue: { categoryId: null },
        newValue: { categoryId: "cat-1" },
      }),
    });
  });

  it("rejects an invalid category with INVALID_CATEGORY and creates nothing", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    providerFindUniqueMock.mockResolvedValue({ id: PROVIDER_ID });
    assertAssignableCategoryMock.mockResolvedValue(false);

    const result = await createService(buildFormData(baseFields({ categoryId: "bad" })));

    expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });
});
