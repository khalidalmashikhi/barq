import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const categoryFindUniqueMock = vi.fn();
const experienceUpsertMock = vi.fn();
const experienceUpdateManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    // resolveTouristGuideCategoryId() (TOUR-1).
    category: { findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        price: { updateMany: (...args: unknown[]) => priceUpdateManyMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
        experience: {
          upsert: (...args: unknown[]) => experienceUpsertMock(...args),
          updateMany: (...args: unknown[]) => experienceUpdateManyMock(...args),
        },
        tourServiceVehicle: { deleteMany: (...args: unknown[]) => poolDeleteManyMock(...args) },
      }),
  },
}));

const poolDeleteManyMock = vi.fn();

vi.mock("@/lib/categories/resolve-assignable-category", () => ({
  resolveAssignableCategory: (...args: unknown[]) => resolveAssignableCategoryMock(...args),
}));

// Gate B5 — the provider authorization primitive. Default AUTHORIZED (true);
// the unauthorized path is exercised explicitly below.
const isProviderAuthorizedForCategoryMock = vi.fn();
vi.mock("./activities/assert-provider-authorized-for-category", () => ({
  isProviderAuthorizedForCategory: (...args: unknown[]) => isProviderAuthorizedForCategoryMock(...args),
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

beforeEach(() => {
  // A category CHANGE is authorized by default; specific tests override.
  isProviderAuthorizedForCategoryMock.mockResolvedValue(true);
  // TOUR-VEHICLE-2 — the pool-clear deleteMany runs whenever a package that forbids a
  // vehicle is set or content is cleared; default to "nothing to clear" so unrelated
  // tests are unaffected.
  poolDeleteManyMock.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  findUniqueMock.mockReset();
  updateMock.mockReset();
  priceUpdateManyMock.mockReset();
  auditCreateMock.mockReset();
  resolveAssignableCategoryMock.mockReset();
  isProviderAuthorizedForCategoryMock.mockReset();
  categoryFindUniqueMock.mockReset();
  experienceUpsertMock.mockReset();
  experienceUpdateManyMock.mockReset();
  poolDeleteManyMock.mockReset();
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

  // Gate B5 — Provider Service Category Authorization (only on category CHANGE).
  describe("category authorization (Gate B5)", () => {
    it("rejects a category CHANGE to a valid-but-unauthorized category (ACTIVITY_NOT_AUTHORIZED, mutates nothing)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "old-cat", serviceType: "EXPERIENCE" });
      resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
      isProviderAuthorizedForCategoryMock.mockResolvedValue(false);

      const result = await updateService(
        SERVICE_ID,
        buildFormData({ nameAr: "جولة", nameEn: "Tour", categoryId: "new-cat" })
      );

      expect(result).toEqual({ ok: false, error: "ACTIVITY_NOT_AUTHORIZED" });
      expect(isProviderAuthorizedForCategoryMock).toHaveBeenCalledWith("provider-1", "new-cat");
      expect(updateMock).not.toHaveBeenCalled();
      expect(auditCreateMock).not.toHaveBeenCalled();
    });

    it("checks authorization only AFTER validity — an invalid category never reaches the authorization check", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "old-cat", serviceType: "EXPERIENCE" });
      resolveAssignableCategoryMock.mockResolvedValue(null);

      const result = await updateService(
        SERVICE_ID,
        buildFormData({ nameAr: "جولة", nameEn: "Tour", categoryId: "bad-cat" })
      );

      expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
      expect(isProviderAuthorizedForCategoryMock).not.toHaveBeenCalled();
    });

    it("HISTORICAL COMPATIBILITY: a metadata-only save re-submitting the SAME category never triggers the authorization check", async () => {
      // The edit form always re-submits the current categoryId as its default.
      // Even if the provider is no longer authorized for that historical category,
      // an unchanged category is not a "change" → no authorization check, no block.
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "historical-cat", serviceType: "EXPERIENCE" });
      updateMock.mockResolvedValue({});

      const result = await updateService(
        SERVICE_ID,
        buildFormData({ nameAr: "اسم جديد", nameEn: "New name", categoryId: "historical-cat" })
      );

      expect(result).toEqual({ ok: true });
      expect(resolveAssignableCategoryMock).not.toHaveBeenCalled();
      expect(isProviderAuthorizedForCategoryMock).not.toHaveBeenCalled();
    });
  });

  // TOUR-1 — smart tour-guide guidingContent on update.
  describe("smart tour-guide guidingContent (TOUR-1)", () => {
    const TG_CAT = "tg-cat";
    const guiding = () =>
      JSON.stringify({
        version: 1,
        packageType: "GUIDE_ONLY",
        durationMinutes: 90,
        meetingPoint: "Souq",
        pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
        maxGuests: 3,
        languages: ["Arabic"],
        itinerary: [],
        includedItems: [],
        excludedItems: [],
        difficulty: null,
        childFriendly: null,
        privateTour: null,
        recommendedEquipment: [],
        refreshmentsIncluded: null,
        importantNotes: null,
        vehicle: null,
      });

    it("metadata-only update never touches Experience or resolves the tour category", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      updateMock.mockResolvedValue({});

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name" }));

      expect(result).toEqual({ ok: true });
      expect(categoryFindUniqueMock).not.toHaveBeenCalled();
      expect(experienceUpsertMock).not.toHaveBeenCalled();
      expect(experienceUpdateManyMock).not.toHaveBeenCalled();
    });

    it("valid guidingContent update on an eligible service upserts Experience", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
      updateMock.mockResolvedValue({});
      experienceUpsertMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name", guidingContent: guiding() }));

      expect(result).toEqual({ ok: true });
      expect(experienceUpsertMock).toHaveBeenCalledWith(expect.objectContaining({ where: { serviceId: SERVICE_ID } }));
    });

    it("invalid guidingContent rejects the whole update (nothing written)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name", guidingContent: "{bad" }));

      expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_INVALID" });
      expect(updateMock).not.toHaveBeenCalled();
      expect(experienceUpsertMock).not.toHaveBeenCalled();
    });

    it("transition AWAY (tourist-guide -> generic) clears guidingContent atomically", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
      resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "TRANSPORT" });
      updateMock.mockResolvedValue({});
      experienceUpdateManyMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name", categoryId: "generic-cat" }));

      expect(result).toEqual({ ok: true });
      expect(experienceUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { serviceId: SERVICE_ID } }));
      expect(experienceUpsertMock).not.toHaveBeenCalled();
    });

    it("transition INTO (generic -> tourist-guide) with valid guidingContent upserts it", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: "generic-cat", serviceType: "TRANSPORT" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
      resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
      updateMock.mockResolvedValue({});
      experienceUpsertMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await updateService(
        SERVICE_ID,
        buildFormData({ nameAr: "اسم", nameEn: "Name", categoryId: TG_CAT, guidingContent: guiding() })
      );

      expect(result).toEqual({ ok: true });
      expect(experienceUpsertMock).toHaveBeenCalled();
    });

    // TOUR-VEHICLE-2 — the relational vehicle pool must stay consistent with the package.
    it("setting a vehicle-forbidding package (GUIDE_ONLY) clears the pool and audits it", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
      updateMock.mockResolvedValue({});
      experienceUpsertMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});
      poolDeleteManyMock.mockResolvedValue({ count: 2 });

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name", guidingContent: guiding() }));

      expect(result).toEqual({ ok: true });
      expect(poolDeleteManyMock).toHaveBeenCalledWith({ where: { serviceId: SERVICE_ID } });
      expect(auditCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "tour.vehicle_pool_cleared",
          newValue: { reason: "package_forbids_vehicle", removed: 2 },
        }),
      });
    });

    it("transition AWAY from tourist-guide clears any configured pool (reason category_changed)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", categoryId: TG_CAT, serviceType: "EXPERIENCE" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
      resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "TRANSPORT" });
      updateMock.mockResolvedValue({});
      experienceUpdateManyMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});
      poolDeleteManyMock.mockResolvedValue({ count: 1 });

      const result = await updateService(SERVICE_ID, buildFormData({ nameAr: "اسم", nameEn: "Name", categoryId: "generic-cat" }));

      expect(result).toEqual({ ok: true });
      expect(poolDeleteManyMock).toHaveBeenCalledWith({ where: { serviceId: SERVICE_ID } });
      expect(auditCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "tour.vehicle_pool_cleared", newValue: { reason: "category_changed", removed: 1 } }),
      });
    });
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
