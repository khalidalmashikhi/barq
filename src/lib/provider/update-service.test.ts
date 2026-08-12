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
const priceUpdateManyMock = vi.fn();
const auditCreateMock = vi.fn();
const resolveAssignableCategoryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        price: { updateMany: (...args: unknown[]) => priceUpdateManyMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

vi.mock("@/lib/categories/resolve-assignable-category", () => ({
  resolveAssignableCategory: (...args: unknown[]) => resolveAssignableCategoryMock(...args),
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
  priceUpdateManyMock.mockReset();
  auditCreateMock.mockReset();
  resolveAssignableCategoryMock.mockReset();
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

  it("changing category to a different vertical RE-DERIVES serviceType (BR-028) and audits the change", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    // The service was EXPERIENCE; moving it to a RENTAL category re-derives RENTAL.
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: null, serviceType: "EXPERIENCE" });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "RENTAL" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "سيارة", nameEn: "Car", categoryId: "cars-cat" })
    );

    expect(result).toEqual({ ok: true });
    expect(resolveAssignableCategoryMock).toHaveBeenCalledWith("cars-cat");
    // BOTH categoryId and the re-derived serviceType update together.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cars-cat", serviceType: "RENTAL" }) })
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "service.category_changed",
        previousValue: { categoryId: null },
        newValue: { categoryId: "cars-cat" },
      }),
    });
  });

  it("rejects an unassignable category with INVALID_CATEGORY and mutates nothing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: null, serviceType: "EXPERIENCE" });
    resolveAssignableCategoryMock.mockResolvedValue(null);

    const result = await updateService(
      SERVICE_ID,
      buildFormData({ nameAr: "جولة", nameEn: "Tour", categoryId: "bad-cat" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("leaves category AND serviceType untouched (no resolve, no audit) when categoryId is omitted", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "existing-cat", serviceType: "EXPERIENCE" });
    updateMock.mockResolvedValue({});

    const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

    expect(result).toEqual({ ok: true });
    expect(resolveAssignableCategoryMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(updateMock.mock.calls[0]![0].data).not.toHaveProperty("categoryId");
    expect(updateMock.mock.calls[0]![0].data).not.toHaveProperty("serviceType");
  });

  // Core Service Enrichment, Gate 3 — regionCode (Service) + pricingUnit (ACTIVE Price).
  describe("region + pricing unit (Gate 3)", () => {
    it("sets a valid regionCode on the Service, and pricingUnit on the ACTIVE price only (metadata, no new row)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "c", serviceType: "EXPERIENCE" });
      updateMock.mockResolvedValue({});
      priceUpdateManyMock.mockResolvedValue({ count: 1 });

      const result = await updateService(
        SERVICE_ID,
        buildFormData({ nameAr: "جولة", nameEn: "Tour", regionCode: "MUSCAT", pricingUnit: "PER_TRIP" })
      );

      expect(result).toEqual({ ok: true });
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ regionCode: "MUSCAT" }) })
      );
      // pricingUnit is written via updateMany on the ACTIVE price — never a new
      // Price row, never touching amount/currency.
      expect(priceUpdateManyMock).toHaveBeenCalledWith({
        where: { serviceId: SERVICE_ID, status: "ACTIVE" },
        data: { pricingUnit: "PER_TRIP" },
      });
    });

    it("clears regionCode to NULL on an explicit empty value (optional field supports clear)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "c", serviceType: "EXPERIENCE" });
      updateMock.mockResolvedValue({});

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour", regionCode: "" }));

      expect(result).toEqual({ ok: true });
      expect(updateMock.mock.calls[0]![0].data.regionCode).toBeNull();
    });

    it("leaves regionCode AND pricingUnit untouched when their fields are absent (no clobber, no price write)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "c", serviceType: "EXPERIENCE" });
      updateMock.mockResolvedValue({});

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour" }));

      expect(result).toEqual({ ok: true });
      expect(updateMock.mock.calls[0]![0].data).not.toHaveProperty("regionCode");
      expect(priceUpdateManyMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid regionCode with INVALID_INPUT and mutates nothing", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "c", serviceType: "EXPERIENCE" });

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour", regionCode: "Muscat" }));

      expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(updateMock).not.toHaveBeenCalled();
      expect(priceUpdateManyMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid pricingUnit with INVALID_INPUT and mutates nothing", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "c", serviceType: "EXPERIENCE" });

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "جولة", nameEn: "Tour", pricingUnit: "PER_NIGHT" }));

      expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(updateMock).not.toHaveBeenCalled();
      expect(priceUpdateManyMock).not.toHaveBeenCalled();
    });
  });
});
