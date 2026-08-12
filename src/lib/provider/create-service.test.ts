import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 0.1 (Foundation Hardening) — regression tests for
// createService(), covering the BR-001 PROVIDER_NOT_APPROVED path this
// action's requireApprovedProvider() call enforces, alongside its
// existing validation and creation logic (previously untested).

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

const serviceCreateMock = vi.fn();
const priceCreateMock = vi.fn();
const auditCreateMock = vi.fn();
const resolveAssignableCategoryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { create: (...args: unknown[]) => serviceCreateMock(...args) },
        price: { create: (...args: unknown[]) => priceCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

vi.mock("@/lib/categories/resolve-assignable-category", () => ({
  resolveAssignableCategory: (...args: unknown[]) => resolveAssignableCategoryMock(...args),
}));

const { createService } = await import("./create-service");
const { ForbiddenError } = await import("@/lib/auth");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  serviceCreateMock.mockReset();
  priceCreateMock.mockReset();
  auditCreateMock.mockReset();
  resolveAssignableCategoryMock.mockReset();
});

describe("createService", () => {
  it("returns INVALID_INPUT without checking provider status when required fields are missing", async () => {
    const result = await createService(buildFormData({ nameAr: "", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("returns PROVIDER_NOT_APPROVED without creating anything when the provider is not approved", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Approved provider status required", "PROVIDER_NOT_APPROVED"));

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("returns NO_PROVIDER_PROFILE when no Provider row exists at all", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("Provider role required"));

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10" }));

    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("creates the service and its price, in the same transaction, for an approved provider", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});

    const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10.50" }));

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(serviceCreateMock).toHaveBeenCalledWith({
      data: {
        providerId: "provider-1",
        serviceType: "EXPERIENCE",
        name: { ar: "جولة", en: "Tour" },
        description: undefined,
      },
    });
    expect(priceCreateMock).toHaveBeenCalledWith({
      data: { serviceId: "service-1", amount: "10.50", currency: "OMR" },
    });
  });

  it("assigns a valid EXPERIENCE category and DERIVES serviceType=EXPERIENCE (BR-028)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: "cat-1" })
    );

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(resolveAssignableCategoryMock).toHaveBeenCalledWith("cat-1");
    expect(serviceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-1", serviceType: "EXPERIENCE" }) })
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PROVIDER",
        action: "service.category_assigned",
        previousValue: { categoryId: null },
        newValue: { categoryId: "cat-1" },
      }),
    });
  });

  it("derives serviceType=RENTAL for a Cars/RENTAL category (BR-028)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "RENTAL" });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await createService(buildFormData({ nameAr: "سيارة", nameEn: "Car", priceAmount: "45", categoryId: "cars-cat" }));

    expect(serviceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serviceType: "RENTAL" }) })
    );
  });

  it("derives serviceType=TRANSPORT for a Transfers/TRANSPORT category (BR-028)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "TRANSPORT" });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    await createService(buildFormData({ nameAr: "نقل", nameEn: "Transfer", priceAmount: "8", categoryId: "transfers-cat" }));

    expect(serviceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serviceType: "TRANSPORT" }) })
    );
  });

  it("never trusts a client-supplied serviceType — it is always derived from the category", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "TRANSPORT" });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    // A spoofed serviceType in the form must be ignored — the category wins.
    await createService(
      buildFormData({ nameAr: "نقل", nameEn: "Transfer", priceAmount: "8", categoryId: "transfers-cat", serviceType: "EXPERIENCE" })
    );

    expect(serviceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serviceType: "TRANSPORT" }) })
    );
  });

  it("rejects an unassignable category with INVALID_CATEGORY and creates nothing (mismatch cannot persist)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    resolveAssignableCategoryMock.mockResolvedValue(null);

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: "bad" })
    );

    expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  // Core Service Enrichment, Gate 3 — regionCode (Service) + pricingUnit (Price).
  describe("region + pricing unit (Gate 3)", () => {
    it("persists a valid regionCode on the Service and pricingUnit on the same Price row", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10.50", regionCode: "DHOFAR", pricingUnit: "PER_PERSON" })
      );

      expect(result).toEqual({ ok: true, serviceId: "service-1" });
      expect(serviceCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ regionCode: "DHOFAR" }) })
      );
      // pricingUnit rides the created Price alongside amount/currency (unchanged).
      expect(priceCreateMock).toHaveBeenCalledWith({
        data: { serviceId: "service-1", amount: "10.50", currency: "OMR", pricingUnit: "PER_PERSON" },
      });
    });

    it("omits regionCode/pricingUnit entirely when they are empty (unset, not stored)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", regionCode: "", pricingUnit: "" })
      );

      expect(serviceCreateMock.mock.calls[0]![0].data).not.toHaveProperty("regionCode");
      expect(priceCreateMock.mock.calls[0]![0].data).not.toHaveProperty("pricingUnit");
    });

    it("rejects an invalid regionCode with INVALID_INPUT before any write", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", regionCode: "Dhofar" })
      );

      expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(serviceCreateMock).not.toHaveBeenCalled();
      expect(priceCreateMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid pricingUnit with INVALID_INPUT before any write", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", pricingUnit: "PER_NIGHT" })
      );

      expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(serviceCreateMock).not.toHaveBeenCalled();
      expect(priceCreateMock).not.toHaveBeenCalled();
    });

    it("leaves amount/currency exactly as-is when a pricingUnit is supplied (unit is metadata, not price)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "25", pricingUnit: "PER_DAY" })
      );

      const priceData = priceCreateMock.mock.calls[0]![0].data;
      expect(priceData.amount).toBe("25");
      expect(priceData.currency).toBe("OMR");
      expect(priceData.pricingUnit).toBe("PER_DAY");
    });
  });
});
