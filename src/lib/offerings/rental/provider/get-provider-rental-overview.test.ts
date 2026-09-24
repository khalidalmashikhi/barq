import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const groupBy = vi.fn();
const vehicleFindMany = vi.fn();
const dayCount = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    rentalOffering: { groupBy: (...a: unknown[]) => groupBy(...a) },
    vehicle: { findMany: (...a: unknown[]) => vehicleFindMany(...a) },
    rentalOfferingDay: { count: (...a: unknown[]) => dayCount(...a) },
  },
}));

const assertVehicleReadyMock = vi.fn();
vi.mock("../rental-offering-authorization", () => ({
  RENTAL_VEHICLE_SELECT: {},
  assertRentalVehicleReady: (...a: unknown[]) => assertVehicleReadyMock(...a),
}));
vi.mock("../rental-service-publishability", () => ({ omanTodayDbDateBoundary: () => new Date("2030-07-01T00:00:00.000Z") }));

const { getProviderRentalWorkspaceOverview } = await import("./get-provider-rental-overview");

beforeEach(() => {
  requireApprovedProviderMock.mockReset().mockResolvedValue({ provider: { id: "prov-1" } });
  groupBy.mockReset();
  vehicleFindMany.mockReset();
  dayCount.mockReset();
  assertVehicleReadyMock.mockReset().mockReturnValue(null);
});

describe("getProviderRentalWorkspaceOverview", () => {
  it("derives per-status counts (total excludes ARCHIVED) and vehicle readiness buckets", async () => {
    groupBy.mockResolvedValue([
      { status: "DRAFT", _count: { _all: 2 } },
      { status: "PUBLISHED", _count: { _all: 3 } },
      { status: "SUSPENDED", _count: { _all: 1 } },
      { status: "ARCHIVED", _count: { _all: 5 } },
    ]);
    // 3 vehicles: 2 ready, 1 not.
    vehicleFindMany.mockResolvedValue([{ assetId: "a" }, { assetId: "b" }, { assetId: "c" }]);
    assertVehicleReadyMock.mockImplementation((v: { assetId: string }) => (v.assetId === "c" ? "VEHICLE_NOT_SELECTABLE" : null));
    dayCount.mockResolvedValue(9);

    const overview = await getProviderRentalWorkspaceOverview();
    expect(overview).toEqual({
      totalOfferings: 6, // 2 + 3 + 1, ARCHIVED excluded
      draftOfferings: 2,
      publishedOfferings: 3,
      suspendedOfferings: 1,
      vehiclesReadyForRental: 2,
      vehiclesRequiringVerification: 1,
      upcomingOpenDays: 9,
    });
  });

  it("scopes every query to the session provider and the upcoming-day boundary", async () => {
    groupBy.mockResolvedValue([]);
    vehicleFindMany.mockResolvedValue([]);
    dayCount.mockResolvedValue(0);

    await getProviderRentalWorkspaceOverview();
    expect(groupBy.mock.calls[0][0].where).toEqual({ service: { providerId: "prov-1" } });
    expect(vehicleFindMany.mock.calls[0][0].where).toEqual({ asset: { providerId: "prov-1", assetType: "VEHICLE" } });
    expect(dayCount.mock.calls[0][0].where).toEqual({
      state: "OPEN",
      serviceDate: { gte: new Date("2030-07-01T00:00:00.000Z") },
      rentalOffering: { service: { providerId: "prov-1" } },
    });
  });

  it("returns zeroes for a provider with no rental data", async () => {
    groupBy.mockResolvedValue([]);
    vehicleFindMany.mockResolvedValue([]);
    dayCount.mockResolvedValue(0);
    const overview = await getProviderRentalWorkspaceOverview();
    expect(overview).toEqual({
      totalOfferings: 0,
      draftOfferings: 0,
      publishedOfferings: 0,
      suspendedOfferings: 0,
      vehiclesReadyForRental: 0,
      vehiclesRequiringVerification: 0,
      upcomingOpenDays: 0,
    });
  });
});
