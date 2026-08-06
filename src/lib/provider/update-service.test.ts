import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 0.1 (Foundation Hardening) — regression tests for
// updateService(), covering the BR-001 PROVIDER_NOT_APPROVED path this
// action's requireApprovedProvider() call enforces, alongside its
// existing validation/ownership logic (previously untested).

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireApprovedProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireApprovedProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(message?: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();
const assertAssignableCategoryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

vi.mock("@/lib/categories/assert-assignable-category", () => ({
  assertAssignableCategory: (...args: unknown[]) => assertAssignableCategoryMock(...args),
}));

const { updateService } = await import("./update-service");
const { ForbiddenError } = await import("@/lib/auth");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
  assertAssignableCategoryMock.mockReset();
});

describe("updateService", () => {
  it("returns INVALID_INPUT for a malformed service id without checking provider status", async () => {
    const result = await updateService("not-a-uuid", buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_APPROVED without mutating anything when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED"));

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when no Provider row exists at all", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Provider role required"));

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't belong to this provider", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "someone-else" });

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates name and description for an approved, owning provider", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1" });
    updateMock.mockResolvedValue({});

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "جولة جديدة", nameEn: "New Tour", descriptionAr: "وصف", descriptionEn: "Desc" })
    );

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: SERVICE_ID },
      data: {
        name: { ar: "جولة جديدة", en: "New Tour" },
        description: { ar: "وصف", en: "Desc" },
      },
    });
  });

  it("assigns a valid, different category (validated against the service's serviceType) and audits the change", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: null, serviceType: "EXPERIENCE" });
    assertAssignableCategoryMock.mockResolvedValue(true);
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "جولة", nameEn: "Tour", categoryId: "cat-123" })
    );

    expect(result).toEqual({ ok: true });
    expect(assertAssignableCategoryMock).toHaveBeenCalledWith("cat-123", "EXPERIENCE");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-123" }) })
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "service.category_changed",
        previousValue: { categoryId: null },
        newValue: { categoryId: "cat-123" },
      }),
    });
  });

  it("rejects an invalid category with INVALID_CATEGORY and mutates nothing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: null, serviceType: "EXPERIENCE" });
    assertAssignableCategoryMock.mockResolvedValue(false);

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "جولة", nameEn: "Tour", categoryId: "bad-cat" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("leaves the category untouched (no validation, no audit) when categoryId is omitted", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "existing-cat", serviceType: "EXPERIENCE" });
    updateMock.mockResolvedValue({});

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: true });
    expect(assertAssignableCategoryMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(updateMock.mock.calls[0]![0].data).not.toHaveProperty("categoryId");
  });
});
