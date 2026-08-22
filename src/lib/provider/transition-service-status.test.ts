import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 5.2 (Production Hardening) — regression tests for
// publishService/unpublishService/archiveService, extended this phase
// to wrap the status update and its new audit-log write in one
// transaction. Only the shared transition() internals are exercised
// once per public entry point — service-status-policy.ts's own matrix
// is already covered by service-status-policy.test.ts.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...args: unknown[]) => requireProviderMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const auditCreateMock = vi.fn();
const categoryFindUniqueMock = vi.fn();
const experienceFindUniqueMock = vi.fn();
const poolFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    price: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    // TOUR-1 — publish reads the canonical tour category + the Experience row.
    category: { findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args) },
    experience: { findUnique: (...args: unknown[]) => experienceFindUniqueMock(...args) },
    // TOUR-VEHICLE-2P — publish readiness reads the tour's configured vehicle pool.
    tourServiceVehicle: { findMany: (...args: unknown[]) => poolFindManyMock(...args) },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        service: { update: (...args: unknown[]) => updateMock(...args) },
        auditLog: { create: (...args: unknown[]) => auditCreateMock(...args) },
      }),
  },
}));

// Gate B5 — publish is authorization-gated on the service's current category.
// Default AUTHORIZED (true); the unauthorized path is exercised explicitly below.
const isProviderAuthorizedForCategoryMock = vi.fn();
vi.mock("./activities/assert-provider-authorized-for-category", () => ({
  isProviderAuthorizedForCategory: (...args: unknown[]) => isProviderAuthorizedForCategoryMock(...args),
}));

const { publishService, unpublishService, archiveService } = await import("./transition-service-status");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

beforeEach(() => {
  isProviderAuthorizedForCategoryMock.mockResolvedValue(true);
});

afterEach(() => {
  requireProviderMock.mockReset();
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  updateMock.mockReset();
  auditCreateMock.mockReset();
  isProviderAuthorizedForCategoryMock.mockReset();
  categoryFindUniqueMock.mockReset();
  experienceFindUniqueMock.mockReset();
  poolFindManyMock.mockReset();
});

describe("publishService", () => {
  it("updates status to PUBLISHED and records an audit event, in the same transaction", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue({ id: "price-1" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: SERVICE_ID }, data: { status: "PUBLISHED" } });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PROVIDER",
        actorId: "provider-1",
        action: "service.published",
        entityType: "Service",
        entityId: SERVICE_ID,
        previousValue: { status: "DRAFT" },
        newValue: { status: "PUBLISHED" },
      }),
    });
  });

  it("returns NO_ACTIVE_PRICE (only) when the service is categorized but has no ACTIVE price", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "NO_ACTIVE_PRICE", blockers: ["NO_ACTIVE_PRICE"] });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("returns SERVICE_CATEGORY_REQUIRED when the service is priced but uncategorized (BR-026)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue({ id: "price-1" });

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_CATEGORY_REQUIRED", blockers: ["SERVICE_CATEGORY_REQUIRED"] });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns BOTH blockers, category first, when uncategorized and priceless", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue(null);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({
      ok: false,
      error: "SERVICE_CATEGORY_REQUIRED",
      blockers: ["SERVICE_CATEGORY_REQUIRED", "NO_ACTIVE_PRICE"],
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  // Gate B5 — the customer-facing gate: publish requires the CURRENT category to
  // be authorized for this provider.
  it("blocks publish with ACTIVITY_NOT_AUTHORIZED when the provider is not authorized for the service's current category", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue({ id: "price-1" }); // price gate passes
    isProviderAuthorizedForCategoryMock.mockResolvedValue(false);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "ACTIVITY_NOT_AUTHORIZED" });
    expect(isProviderAuthorizedForCategoryMock).toHaveBeenCalledWith("provider-1", "cat-1");
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("checks authorization only AFTER the publishable blockers — an uncategorized service never reaches it (SERVICE_CATEGORY_REQUIRED wins)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: null });
    findFirstMock.mockResolvedValue({ id: "price-1" });

    const result = await publishService(SERVICE_ID);

    expect(result.ok).toBe(false);
    expect(isProviderAuthorizedForCategoryMock).not.toHaveBeenCalled();
  });

  it("re-checks authorization when republishing a PAUSED service (PAUSED → PUBLISHED)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "PAUSED", categoryId: "cat-1" });
    findFirstMock.mockResolvedValue({ id: "price-1" });
    isProviderAuthorizedForCategoryMock.mockResolvedValue(false);

    const result = await publishService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "ACTIVITY_NOT_AUTHORIZED" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  // TOUR-1 — an eligible smart-tour service needs valid guidingContent to publish.
  describe("smart tour-guide publish gate (TOUR-1)", () => {
    const TG_CAT = "tg-cat";
    const validGuiding = {
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
    };

    const eligibleService = () => {
      requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: TG_CAT });
      findFirstMock.mockResolvedValue({ id: "price-1" }); // price gate passes
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT }); // eligible
    };

    it("blocks publish with TOUR_TEMPLATE_REQUIRED when guidingContent is missing", async () => {
      eligibleService();
      experienceFindUniqueMock.mockResolvedValue(null);

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_REQUIRED" });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("blocks publish with TOUR_TEMPLATE_INVALID when stored guidingContent is malformed", async () => {
      eligibleService();
      experienceFindUniqueMock.mockResolvedValue({ guidingContent: { garbage: true } });

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: false, error: "TOUR_TEMPLATE_INVALID" });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("publishes an eligible tour service with valid guidingContent", async () => {
      eligibleService();
      experienceFindUniqueMock.mockResolvedValue({ guidingContent: validGuiding });
      updateMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: true });
      expect(updateMock).toHaveBeenCalled();
    });

    it("generic (non-tour) publish succeeds; the publish-readiness vehicle check finds no tour and imposes no blocker", async () => {
      requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", providerType: "INDIVIDUAL" } });
      findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT", categoryId: "generic-cat" });
      findFirstMock.mockResolvedValue({ id: "price-1" });
      categoryFindUniqueMock.mockResolvedValue({ id: TG_CAT }); // service cat != TG_CAT -> not smart-tour eligible
      // TOUR-VEHICLE-2P — the shared publish authority reads the Experience to detect a
      // transport tour; a non-tour service (no Experience) yields no vehicle blocker.
      experienceFindUniqueMock.mockResolvedValue(null);
      updateMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: true });
      expect(updateMock).toHaveBeenCalled();
    });

    // TOUR-VEHICLE-2P — a transport tour cannot be published with no eligible pooled vehicle.
    const transportGuiding = { ...validGuiding, packageType: "GUIDE_WITH_TRANSPORT", vehicle: { type: "SUV", make: null, model: null, year: null, passengerCapacity: null } };

    it("TOUR-VEHICLE-2P — publish of a GUIDE_WITH_TRANSPORT tour with an EMPTY pool is blocked; no status transition", async () => {
      eligibleService();
      experienceFindUniqueMock.mockResolvedValue({ guidingContent: transportGuiding });
      poolFindManyMock.mockResolvedValue([]); // no configured vehicles

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: false, error: "TOUR_VEHICLE_POOL_REQUIRED", blockers: ["TOUR_VEHICLE_POOL_REQUIRED"] });
      expect(updateMock).not.toHaveBeenCalled(); // blocked publish never transitions status
    });

    it("TOUR-VEHICLE-2P — publish of a GUIDE_WITH_TRANSPORT tour with an eligible pooled vehicle succeeds", async () => {
      eligibleService();
      experienceFindUniqueMock.mockResolvedValue({ guidingContent: transportGuiding });
      poolFindManyMock.mockResolvedValue([
        {
          vehicle: {
            assetId: "veh-1", make: "Toyota", model: "Prado", modelYear: 2024, color: "White", vehicleType: "SUV",
            passengerCapacity: 6, publicDescription: null, registrationNumber: "OM 1", claimedFourByFour: null, fourByFourVerified: null,
            createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
            asset: { status: "ACTIVE", providerId: "provider-1", verificationStatus: "APPROVED", documents: [
              { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: new Date("2027-01-01T00:00:00Z") },
              { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: new Date("2027-01-01T00:00:00Z") },
            ] },
          },
        },
      ]);
      updateMock.mockResolvedValue({});
      auditCreateMock.mockResolvedValue({});

      const result = await publishService(SERVICE_ID);

      expect(result).toEqual({ ok: true });
      expect(updateMock).toHaveBeenCalled();
    });
  });
});

describe("unpublishService", () => {
  it("updates status to PAUSED and records action service.unpublished", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "PUBLISHED" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await unpublishService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.unpublished", newValue: { status: "PAUSED" } }),
    });
  });
});

describe("archiveService", () => {
  it("updates status to ARCHIVED and records action service.archived", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "provider-1", status: "DRAFT" });
    updateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: true });
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "service.archived", newValue: { status: "ARCHIVED" } }),
    });
  });

  it("returns SERVICE_NOT_FOUND when the service doesn't belong to this provider", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    findUniqueMock.mockResolvedValue({ id: SERVICE_ID, providerId: "someone-else", status: "DRAFT" });

    const result = await archiveService(SERVICE_ID);

    expect(result).toEqual({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
