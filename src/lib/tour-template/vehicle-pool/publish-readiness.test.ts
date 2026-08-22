import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const experienceFindUniqueMock = vi.fn();
const poolFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    experience: { findUnique: (...a: unknown[]) => experienceFindUniqueMock(...a) },
    tourServiceVehicle: { findMany: (...a: unknown[]) => poolFindManyMock(...a) },
  },
}));

// parseGuidingContent, TOUR_PACKAGE_SEMANTICS, evaluatePoolVehicle all run REAL — this
// suite exercises the ACTUAL live-eligibility authority end to end.
const { getTourVehiclePublishBlocker } = await import("./publish-readiness");

const SERVICE = { id: "svc-1", providerId: "prov-1" };
const FUTURE = new Date("2027-01-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

// A full, contract-valid guidingContent for a given package. Transport packages require a
// vehicle promise; GUIDE_WITH_4X4 requires the promise type FOUR_BY_FOUR.
function guidingContent(packageType: string, opts: { maxGuests?: number | null } = {}) {
  const transport = packageType === "GUIDE_WITH_TRANSPORT" || packageType === "GUIDE_WITH_4X4";
  const vehicle = transport
    ? { type: packageType === "GUIDE_WITH_4X4" ? "FOUR_BY_FOUR" : "SUV", make: null, model: null, year: null, passengerCapacity: null }
    : null;
  return {
    version: 1,
    packageType,
    durationMinutes: null,
    meetingPoint: null,
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: opts.maxGuests ?? null,
    languages: [],
    itinerary: [],
    includedItems: [],
    excludedItems: [],
    difficulty: null,
    childFriendly: null,
    privateTour: null,
    recommendedEquipment: [],
    refreshmentsIncluded: null,
    importantNotes: null,
    vehicle,
  };
}

// A pooled vehicle row (as { vehicle }, matching the reader's select shape).
function poolRow(over: Record<string, unknown> = {}) {
  return {
    vehicle: {
      assetId: "veh-1",
      make: "Toyota",
      model: "Prado",
      modelYear: 2024,
      color: "White",
      vehicleType: "SUV",
      passengerCapacity: 6,
      publicDescription: null,
      registrationNumber: "OM 1",
      claimedFourByFour: null,
      fourByFourVerified: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      asset: {
        status: "ACTIVE",
        providerId: "prov-1",
        verificationStatus: "APPROVED",
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: FUTURE },
          { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
        ],
      },
      ...over,
    },
  };
}
function withVehicle(over: Record<string, unknown>) {
  const base = poolRow();
  return { vehicle: { ...base.vehicle, ...over } };
}
function withAsset(over: Record<string, unknown>) {
  const base = poolRow();
  return { vehicle: { ...base.vehicle, asset: { ...base.vehicle.asset, ...over } } };
}

afterEach(() => {
  experienceFindUniqueMock.mockReset();
  poolFindManyMock.mockReset();
});

function setup(packageType: string, rows: unknown[], opts: { maxGuests?: number | null } = {}) {
  experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent(packageType, opts) });
  poolFindManyMock.mockResolvedValue(rows);
}

describe("getTourVehiclePublishBlocker — TOUR-VEHICLE-2P publish readiness", () => {
  it("non-tour service (no guidingContent) => null, never queries the pool", async () => {
    experienceFindUniqueMock.mockResolvedValue(null);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("unparseable stored guidingContent => null (not an enforceable tour-vehicle context)", async () => {
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: { version: 1, packageType: "NONSENSE" } });
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("1. GUIDE_ONLY => null (no vehicle required), pool never consulted", async () => {
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent("GUIDE_ONLY") });
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("14. PRIVATE_CUSTOM_TOUR (vehicle optional) => null", async () => {
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent("PRIVATE_CUSTOM_TOUR") });
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("2. GUIDE_WITH_TRANSPORT + empty pool => TOUR_VEHICLE_POOL_REQUIRED", async () => {
    setup("GUIDE_WITH_TRANSPORT", []);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("3. GUIDE_WITH_TRANSPORT + one eligible pooled vehicle => null", async () => {
    setup("GUIDE_WITH_TRANSPORT", [poolRow()]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
  });

  it("4. GUIDE_WITH_TRANSPORT + pooled REGISTERED (not active) => blocked", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withAsset({ status: "REGISTERED" })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("5. GUIDE_WITH_TRANSPORT + pooled verification not approved => blocked", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withAsset({ verificationStatus: "SUBMITTED" })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("6. GUIDE_WITH_TRANSPORT + pooled expired required doc => blocked", async () => {
    setup("GUIDE_WITH_TRANSPORT", [
      withAsset({
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: PAST },
          { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
        ],
      }),
    ]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("7. GUIDE_WITH_TRANSPORT + insufficient guest capacity vs maxGuests => blocked", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withVehicle({ passengerCapacity: 4 })], { maxGuests: 6 });
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("8. GUIDE_WITH_TRANSPORT + one ineligible + one eligible => null (publishable)", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withAsset({ status: "REGISTERED" }), poolRow()]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
  });

  it("9/10/11/12. GUIDE_WITH_4X4 + trusted null / false / SUV / type-code-only => blocked", async () => {
    setup("GUIDE_WITH_4X4", [withVehicle({ fourByFourVerified: null })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
    setup("GUIDE_WITH_4X4", [withVehicle({ fourByFourVerified: false })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
    // SUV / a FOUR_BY_FOUR vehicleType code + a provider claim never substitute for trusted.
    setup("GUIDE_WITH_4X4", [withVehicle({ vehicleType: "FOUR_BY_FOUR", claimedFourByFour: true, fourByFourVerified: null })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBe("TOUR_VEHICLE_POOL_REQUIRED");
  });

  it("13. GUIDE_WITH_4X4 + trusted true + otherwise eligible => null", async () => {
    setup("GUIDE_WITH_4X4", [withVehicle({ fourByFourVerified: true })]);
    expect(await getTourVehiclePublishBlocker(SERVICE)).toBeNull();
  });

  it("uses bounded reads — one Experience query + one pool query (no per-vehicle query)", async () => {
    setup("GUIDE_WITH_TRANSPORT", [poolRow(), withVehicle({ assetId: "veh-2" })]);
    await getTourVehiclePublishBlocker(SERVICE);
    expect(experienceFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(poolFindManyMock).toHaveBeenCalledTimes(1);
  });
});
