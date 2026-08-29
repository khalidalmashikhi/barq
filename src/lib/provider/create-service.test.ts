import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const categoryFindUniqueMock = vi.fn();
const experienceCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    // resolveTouristGuideCategoryId() (TOUR-1) reads the canonical slug here.
    category: { findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { create: (...args: unknown[]) => serviceCreateMock(...args) },
        price: { create: (...args: unknown[]) => priceCreateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
        experience: { create: (...args: unknown[]) => experienceCreateMock(...args) },
      }),
  },
}));

vi.mock("@/lib/categories/resolve-assignable-category", () => ({
  resolveAssignableCategory: (...args: unknown[]) => resolveAssignableCategoryMock(...args),
}));

// Gate B5 — the provider authorization primitive. Default AUTHORIZED (true) via
// beforeEach; the unauthorized path is exercised explicitly below.
const isProviderAuthorizedForCategoryMock = vi.fn();
vi.mock("./activities/assert-provider-authorized-for-category", () => ({
  isProviderAuthorizedForCategory: (...args: unknown[]) => isProviderAuthorizedForCategoryMock(...args),
}));

const { createService } = await import("./create-service");
const { ForbiddenError } = await import("@/lib/auth");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  // A new ACTIVE price now REQUIRES a governed, bookable pricing unit (PRICING UNIT DATA
  // INTEGRITY). Default it here so tests that don't care about pricing still create; tests
  // that exercise the unit contract pass it explicitly (including "" to assert rejection).
  const withDefaults = { pricingUnit: "PER_PERSON", ...fields };
  for (const [key, value] of Object.entries(withDefaults)) {
    formData.set(key, value);
  }
  return formData;
}

beforeEach(() => {
  // A categorized create is authorized by default; specific tests override.
  isProviderAuthorizedForCategoryMock.mockResolvedValue(true);
});

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  serviceCreateMock.mockReset();
  priceCreateMock.mockReset();
  auditCreateMock.mockReset();
  resolveAssignableCategoryMock.mockReset();
  isProviderAuthorizedForCategoryMock.mockReset();
  categoryFindUniqueMock.mockReset();
  experienceCreateMock.mockReset();
});

// TOUR-1 — smart tour-guide guidingContent on create. The canonical tourist-guide
// category id is "tg-cat"; an INDIVIDUAL provider owning that category is eligible.
const TG_CAT = "tg-cat";
function validGuidingContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    packageType: "GUIDE_ONLY",
    durationMinutes: 120,
    meetingPoint: "Nizwa Fort",
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: 4,
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
    ...overrides,
  });
}

describe("createService — smart tour-guide guidingContent (TOUR-1)", () => {
  it("persists normalized guidingContent for an eligible INDIVIDUAL tourist-guide service", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });
    serviceCreateMock.mockResolvedValue({ id: "service-1" });
    priceCreateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});
    experienceCreateMock.mockResolvedValue({});

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: TG_CAT, guidingContent: validGuidingContent() })
    );

    expect(result).toEqual({ ok: true, serviceId: "service-1" });
    expect(experienceCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serviceId: "service-1" }) })
    );
  });

  it("rejects an eligible tour service with MALFORMED guidingContent, creating nothing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: TG_CAT, guidingContent: "{bad json" })
    );

    expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_INVALID" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
    expect(experienceCreateMock).not.toHaveBeenCalled();
  });

  it("rejects guidingContent injected onto a NON-tour category (not eligible), creating nothing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: "other-cat", guidingContent: validGuidingContent() })
    );

    expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_NOT_ELIGIBLE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("rejects guidingContent from a COMPANY provider on the tourist-guide category (not eligible)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "COMPANY" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT });

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: TG_CAT, guidingContent: validGuidingContent() })
    );

    expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_NOT_ELIGIBLE" });
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("B5 unauthorized category is rejected BEFORE tour validation (ordering preserved)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
    resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
    isProviderAuthorizedForCategoryMock.mockResolvedValue(false);

    const result = await createService(
      buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: TG_CAT, guidingContent: validGuidingContent() })
    );

    expect(result).toEqual({ ok: false, error: "ACTIVITY_NOT_AUTHORIZED" });
    expect(categoryFindUniqueMock).not.toHaveBeenCalled(); // never reached tour eligibility
  });
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
      data: { serviceId: "service-1", amount: "10.50", currency: "OMR", pricingUnit: "PER_PERSON" },
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

  // Gate B5 — Provider Service Category Authorization.
  describe("category authorization (Gate B5)", () => {
    it("rejects a valid category the provider is NOT authorized for (ACTIVITY_NOT_AUTHORIZED, creates nothing)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      resolveAssignableCategoryMock.mockResolvedValue({ serviceTypeKey: "EXPERIENCE" });
      isProviderAuthorizedForCategoryMock.mockResolvedValue(false);

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: "cat-1" })
      );

      expect(result).toEqual({ ok: false, error: "ACTIVITY_NOT_AUTHORIZED" });
      expect(isProviderAuthorizedForCategoryMock).toHaveBeenCalledWith("provider-1", "cat-1");
      expect(serviceCreateMock).not.toHaveBeenCalled();
    });

    it("checks authorization only AFTER validity — an invalid category never reaches the authorization check", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      resolveAssignableCategoryMock.mockResolvedValue(null);

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", categoryId: "bad" })
      );

      expect(result).toEqual({ ok: false, error: "INVALID_CATEGORY" });
      expect(isProviderAuthorizedForCategoryMock).not.toHaveBeenCalled();
    });

    it("never checks authorization for an uncategorized draft (category optional at create)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      const result = await createService(buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10" }));

      expect(result).toEqual({ ok: true, serviceId: "service-1" });
      expect(isProviderAuthorizedForCategoryMock).not.toHaveBeenCalled();
    });
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

    it("omits regionCode when empty, but still requires (and stores) a bookable pricingUnit", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", regionCode: "", pricingUnit: "PER_VEHICLE" })
      );

      expect(serviceCreateMock.mock.calls[0]![0].data).not.toHaveProperty("regionCode");
      expect(priceCreateMock.mock.calls[0]![0].data.pricingUnit).toBe("PER_VEHICLE");
    });

    it("rejects an empty pricingUnit — a new ACTIVE price must carry a bookable unit (never defaulted)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", pricingUnit: "" })
      );

      expect(result).toEqual({ ok: false, error: "PRICING_UNIT_REQUIRED" });
      expect(serviceCreateMock).not.toHaveBeenCalled();
      expect(priceCreateMock).not.toHaveBeenCalled();
    });

    it("rejects a reserved duration unit (PER_DAY/PER_HOUR) — not billable yet", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

      for (const unit of ["PER_DAY", "PER_HOUR"]) {
        serviceCreateMock.mockClear();
        priceCreateMock.mockClear();
        const result = await createService(
          buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", pricingUnit: unit })
        );
        expect(result).toEqual({ ok: false, error: "PRICING_UNIT_REQUIRED" });
        expect(serviceCreateMock).not.toHaveBeenCalled();
      }
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

    it("rejects an unknown pricingUnit with PRICING_UNIT_REQUIRED before any write", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });

      const result = await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "10", pricingUnit: "PER_NIGHT" })
      );

      expect(result).toEqual({ ok: false, error: "PRICING_UNIT_REQUIRED" });
      expect(serviceCreateMock).not.toHaveBeenCalled();
      expect(priceCreateMock).not.toHaveBeenCalled();
    });

    it("leaves amount/currency exactly as-is when a bookable pricingUnit is supplied (unit is metadata, not price)", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
      serviceCreateMock.mockResolvedValue({ id: "service-1" });
      priceCreateMock.mockResolvedValue({});

      await createService(
        buildFormData({ nameAr: "جولة", nameEn: "Tour", priceAmount: "25", pricingUnit: "PER_VEHICLE" })
      );

      const priceData = priceCreateMock.mock.calls[0]![0].data;
      expect(priceData.amount).toBe("25");
      expect(priceData.currency).toBe("OMR");
      expect(priceData.pricingUnit).toBe("PER_VEHICLE");
    });
  });
});
