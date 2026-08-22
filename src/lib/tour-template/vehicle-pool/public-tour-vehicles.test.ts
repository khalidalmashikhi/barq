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

// parseGuidingContent, TOUR_PACKAGE_SEMANTICS, evaluatePoolVehicle run REAL.
const { getPublicTourVehicleSummary } = await import("./public-tour-vehicles");

const FUTURE = new Date("2027-01-01T00:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");

function guidingContent(packageType: string, opts: { vehicle?: unknown; maxGuests?: number | null } = {}) {
  const transport = packageType === "GUIDE_WITH_TRANSPORT" || packageType === "GUIDE_WITH_4X4";
  const vehicle =
    "vehicle" in opts
      ? opts.vehicle
      : transport
        ? { type: packageType === "GUIDE_WITH_4X4" ? "FOUR_BY_FOUR" : "SUV", make: null, model: null, year: null, passengerCapacity: null }
        : null;
  return {
    version: 1, packageType, durationMinutes: null, meetingPoint: null,
    pickup: { included: false, area: null, hotelPickup: false, airportPickup: false },
    maxGuests: opts.maxGuests ?? null, languages: [], itinerary: [], includedItems: [], excludedItems: [],
    difficulty: null, childFriendly: null, privateTour: null, recommendedEquipment: [], refreshmentsIncluded: null,
    importantNotes: null, vehicle,
  };
}

function poolRow(over: Record<string, unknown> = {}) {
  return {
    vehicle: {
      assetId: "veh-1", make: "Toyota", model: "Prado", modelYear: 2024, color: "White", vehicleType: "SUV",
      passengerCapacity: 6, publicDescription: null, registrationNumber: "OM 12345", claimedFourByFour: true, fourByFourVerified: null,
      createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
      asset: {
        status: "ACTIVE", providerId: "prov-1", verificationStatus: "APPROVED",
        documents: [
          { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: FUTURE },
          { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
        ],
      },
      ...over,
    },
  };
}
const withVehicle = (o: Record<string, unknown>) => ({ vehicle: { ...poolRow().vehicle, ...o } });
const withAsset = (o: Record<string, unknown>) => ({ vehicle: { ...poolRow().vehicle, asset: { ...poolRow().vehicle.asset, ...o } } });

function setup(packageType: string, rows: unknown[], opts: { vehicle?: unknown; maxGuests?: number | null } = {}) {
  experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent(packageType, opts) });
  poolFindManyMock.mockResolvedValue(rows);
}

afterEach(() => {
  experienceFindUniqueMock.mockReset();
  poolFindManyMock.mockReset();
});

describe("getPublicTourVehicleSummary — TOUR-VEHICLE-3 customer-safe read", () => {
  it("non-tour / unparseable / GUIDE_ONLY => null, pool never consulted", async () => {
    experienceFindUniqueMock.mockResolvedValue(null);
    expect(await getPublicTourVehicleSummary("svc")).toBeNull();
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: { version: 1, packageType: "NONSENSE" } });
    expect(await getPublicTourVehicleSummary("svc")).toBeNull();
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent("GUIDE_ONLY") });
    expect(await getPublicTourVehicleSummary("svc")).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("PRIVATE_CUSTOM_TOUR: no declared vehicle => null; declared vehicle => summary (transportIncluded false)", async () => {
    experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent("PRIVATE_CUSTOM_TOUR", { vehicle: null }) });
    expect(await getPublicTourVehicleSummary("svc")).toBeNull();

    experienceFindUniqueMock.mockResolvedValue({ guidingContent: guidingContent("PRIVATE_CUSTOM_TOUR", { vehicle: { type: "SUV", make: null, model: null, year: null, passengerCapacity: null } }) });
    poolFindManyMock.mockResolvedValue([poolRow()]);
    const s = await getPublicTourVehicleSummary("svc");
    expect(s).toMatchObject({ transportIncluded: false, requiresFourByFour: false });
    expect(s?.vehicles.length).toBe(1);
  });

  it("GUIDE_WITH_TRANSPORT + eligible vehicle => summary with ONLY the safe allowlist (no private fields)", async () => {
    setup("GUIDE_WITH_TRANSPORT", [poolRow()]);
    const s = await getPublicTourVehicleSummary("svc");
    expect(s).toMatchObject({ transportIncluded: true, requiresFourByFour: false });
    expect(s?.vehicles).toEqual([
      { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false },
    ]);
    // Privacy: the full serialized summary carries none of the private/pool-join fields.
    const json = JSON.stringify(s);
    for (const forbidden of ["registrationNumber", "claimedFourByFour", "fourByFourVerified", "objectKey", "OM 12345", "vehicleId", "assetId", "isInPool", "blockers", "verificationStatus", "status"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(s?.vehicles[0]).not.toHaveProperty("registrationNumber");
    expect(s?.vehicles[0]?.isFourByFour).toBe(false); // trusted null → fail-closed
  });

  it("excludes currently-ineligible pooled vehicles; 1 eligible + 1 ineligible => only eligible", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withAsset({ status: "REGISTERED" }), withVehicle({ assetId: "veh-2", make: "Nissan", model: "Patrol" })]);
    const s = await getPublicTourVehicleSummary("svc");
    expect(s?.vehicles.map((v) => v.model)).toEqual(["Patrol"]);
  });

  it("all pooled vehicles ineligible => degraded: transportIncluded true, empty vehicles (no stale data)", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withAsset({ verificationStatus: "SUBMITTED" }), withAsset({ documents: [
      { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: PAST },
      { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
    ] })]);
    const s = await getPublicTourVehicleSummary("svc");
    expect(s).toEqual({ transportIncluded: true, requiresFourByFour: false, vehicles: [] });
  });

  it("GUIDE_WITH_4X4: only a trusted-4x4 vehicle appears; SUV/type-code/claim without trusted are excluded", async () => {
    // trusted null/false/type-code-only → excluded → degraded empty.
    setup("GUIDE_WITH_4X4", [withVehicle({ fourByFourVerified: null, vehicleType: "FOUR_BY_FOUR", claimedFourByFour: true })]);
    expect((await getPublicTourVehicleSummary("svc"))?.vehicles).toEqual([]);
    // trusted true → shown, with isFourByFour true.
    setup("GUIDE_WITH_4X4", [withVehicle({ fourByFourVerified: true })]);
    const s = await getPublicTourVehicleSummary("svc");
    expect(s).toMatchObject({ transportIncluded: true, requiresFourByFour: true });
    expect(s?.vehicles[0]?.isFourByFour).toBe(true);
  });

  it("insufficient guest capacity vs maxGuests excludes the vehicle", async () => {
    setup("GUIDE_WITH_TRANSPORT", [withVehicle({ passengerCapacity: 3 })], { maxGuests: 6 });
    expect((await getPublicTourVehicleSummary("svc"))?.vehicles).toEqual([]);
  });

  it("bounded reads — one Experience query + one pool query", async () => {
    setup("GUIDE_WITH_TRANSPORT", [poolRow(), withVehicle({ assetId: "veh-2" })]);
    await getPublicTourVehicleSummary("svc");
    expect(experienceFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(poolFindManyMock).toHaveBeenCalledTimes(1);
  });
});
