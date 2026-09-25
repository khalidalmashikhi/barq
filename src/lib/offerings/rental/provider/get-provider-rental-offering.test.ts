import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const offeringFindFirst = vi.fn();
const dayFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    rentalOffering: { findFirst: (...a: unknown[]) => offeringFindFirst(...a) },
    rentalOfferingDay: { findFirst: (...a: unknown[]) => dayFindFirst(...a) },
  },
}));

const assertVerticalMock = vi.fn();
const assertVehicleReadyMock = vi.fn();
vi.mock("../rental-offering-authorization", () => ({
  RENTAL_VEHICLE_SELECT: {},
  assertRentalVerticalCompliant: (...a: unknown[]) => assertVerticalMock(...a),
  assertRentalVehicleReady: (...a: unknown[]) => assertVehicleReadyMock(...a),
}));
vi.mock("../rental-service-publishability", () => ({ omanTodayDbDateBoundary: () => new Date("2030-07-01T00:00:00.000Z") }));

const { getProviderRentalOfferingWithDays } = await import("./get-provider-rental-offering");

const dec = (s: string) => ({ toFixed: () => s });
const vehicle = {
  assetId: "veh-1",
  bookablePassengerCapacity: 6,
  make: "Toyota",
  model: "Hiace",
  modelYear: 2029,
  color: "White",
  vehicleType: "VAN",
  registeredSeats: 12,
  asset: { providerId: "prov-1", assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] },
};

beforeEach(() => {
  requireApprovedProviderMock.mockReset().mockResolvedValue({ provider: { id: "prov-1" } });
  offeringFindFirst.mockReset();
  dayFindFirst.mockReset().mockResolvedValue(null); // no override anywhere by default
  assertVerticalMock.mockReset().mockResolvedValue(null);
  assertVehicleReadyMock.mockReset().mockReturnValue(null);
});

describe("getProviderRentalOfferingWithDays", () => {
  it("returns null (non-enumerating) for a missing/foreign offering, scoped to the session provider", async () => {
    offeringFindFirst.mockResolvedValue(null);
    const result = await getProviderRentalOfferingWithDays("off-x");
    expect(result).toBeNull();
    expect(offeringFindFirst.mock.calls[0]?.[0]?.where).toEqual({ id: "off-x", service: { providerId: "prov-1" } });
  });

  it("resolves per-day price (override wins over base) and counts upcoming OPEN days", async () => {
    offeringFindFirst.mockResolvedValue({
      id: "off-1",
      serviceId: "svc-1",
      vehicleId: "veh-1",
      status: "PUBLISHED",
      baseDailyAmount: dec("40.00"),
      currency: "OMR",
      offeringCapacityOverride: null,
      service: { name: { en: "Van Rental" } },
      vehicle,
      days: [
        { serviceDate: new Date("2030-06-20T00:00:00.000Z"), state: "OPEN", dailyAmountOverride: null }, // past → not counted
        { serviceDate: new Date("2030-07-10T00:00:00.000Z"), state: "OPEN", dailyAmountOverride: null }, // upcoming OPEN
        { serviceDate: new Date("2030-07-15T00:00:00.000Z"), state: "BLOCKED", dailyAmountOverride: null }, // not counted
        { serviceDate: new Date("2030-07-20T00:00:00.000Z"), state: "OPEN", dailyAmountOverride: dec("55.00") }, // override
      ],
    });

    const result = await getProviderRentalOfferingWithDays("off-1");
    expect(result).not.toBeNull();
    expect(result!.serviceName).toBe("Van Rental");
    expect(result!.registeredSeats).toBe(12);
    expect(result!.upcomingConfiguredOpenDays).toBe(2);
    expect(result!.configuredDays).toEqual([
      { dateKey: "2030-06-20", state: "OPEN", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" },
      { dateKey: "2030-07-10", state: "OPEN", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" },
      { dateKey: "2030-07-15", state: "BLOCKED", dailyAmount: "40.00", currency: "OMR", priceSource: "BASE" },
      { dateKey: "2030-07-20", state: "OPEN", dailyAmount: "55.00", currency: "OMR", priceSource: "OVERRIDE" },
    ]);
  });

  it("hasAnyDailyOverride comes from a GLOBAL existence query, not the visible window", async () => {
    offeringFindFirst.mockResolvedValue({
      id: "off-1", serviceId: "svc-1", vehicleId: "veh-1", status: "DRAFT", baseDailyAmount: dec("40.00"), currency: "OMR",
      offeringCapacityOverride: null, service: { name: { en: "X" } }, vehicle,
      // Visible window shows NO override — yet the global query finds one (past/out-of-window).
      days: [{ serviceDate: new Date("2030-07-10T00:00:00.000Z"), state: "OPEN", dailyAmountOverride: null }],
    });
    dayFindFirst.mockResolvedValue({ id: "some-override-day" });

    const result = await getProviderRentalOfferingWithDays("off-1");
    expect(result!.hasAnyDailyOverride).toBe(true);
    expect(result!.configuredDays.every((d) => d.priceSource === "BASE")).toBe(true); // window has none
    // Bounded, indexed existence check scoped to the offering + any non-null override.
    expect(dayFindFirst.mock.calls[0]?.[0]).toMatchObject({ where: { rentalOfferingId: "off-1", dailyAmountOverride: { not: null } }, select: { id: true } });
  });

  it("hasAnyDailyOverride is false when the global query finds none", async () => {
    offeringFindFirst.mockResolvedValue({
      id: "off-1", serviceId: "svc-1", vehicleId: "veh-1", status: "DRAFT", baseDailyAmount: dec("40.00"), currency: "OMR",
      offeringCapacityOverride: null, service: { name: { en: "X" } }, vehicle, days: [],
    });
    dayFindFirst.mockResolvedValue(null);
    const result = await getProviderRentalOfferingWithDays("off-1");
    expect(result!.hasAnyDailyOverride).toBe(false);
  });

  it("carries a readiness blocker through to the detail view", async () => {
    assertVehicleReadyMock.mockReturnValue("VERIFIED_CAPACITY_MISSING");
    offeringFindFirst.mockResolvedValue({
      id: "off-2", serviceId: "s", vehicleId: "veh-1", status: "DRAFT", baseDailyAmount: dec("10.00"), currency: "OMR",
      offeringCapacityOverride: null, service: { name: { en: "X" } }, vehicle, days: [],
    });
    const result = await getProviderRentalOfferingWithDays("off-2");
    expect(result!.readinessBlocker).toBe("VERIFIED_CAPACITY_MISSING");
    expect(result!.configuredDays).toEqual([]);
    expect(result!.upcomingConfiguredOpenDays).toBe(0);
  });
});
