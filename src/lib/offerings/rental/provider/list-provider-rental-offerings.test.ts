import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
}));

const offeringFindMany = vi.fn();
const dayFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    rentalOffering: { findMany: (...a: unknown[]) => offeringFindMany(...a) },
    rentalOfferingDay: { findMany: (...a: unknown[]) => dayFindMany(...a) },
  },
}));

// Control readiness deterministically: vertical compliance (global) + per-vehicle readiness.
const assertVerticalMock = vi.fn();
const assertVehicleReadyMock = vi.fn();
vi.mock("../rental-offering-authorization", () => ({
  RENTAL_VEHICLE_SELECT: {},
  assertRentalVerticalCompliant: (...a: unknown[]) => assertVerticalMock(...a),
  assertRentalVehicleReady: (...a: unknown[]) => assertVehicleReadyMock(...a),
}));

vi.mock("../rental-service-publishability", () => ({
  omanTodayDbDateBoundary: () => new Date("2030-07-01T00:00:00.000Z"),
}));

const { listProviderRentalOfferings } = await import("./list-provider-rental-offerings");

const dec = (s: string) => ({ toFixed: () => s });
const vehicle = (assetId: string, over: Record<string, unknown> = {}) => ({
  assetId,
  bookablePassengerCapacity: 6,
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2030,
  color: "White",
  vehicleType: "SUV",
  registeredSeats: 7,
  asset: { providerId: "prov-1", assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] },
  ...over,
});

beforeEach(() => {
  requireApprovedProviderMock.mockReset().mockResolvedValue({ provider: { id: "prov-1" } });
  offeringFindMany.mockReset();
  dayFindMany.mockReset().mockResolvedValue([]);
  assertVerticalMock.mockReset().mockResolvedValue(null); // compliant by default
  assertVehicleReadyMock.mockReset().mockReturnValue(null); // ready by default
});

describe("listProviderRentalOfferings", () => {
  it("scopes the query to the session provider (foreign offerings never match)", async () => {
    offeringFindMany.mockResolvedValue([]);
    await listProviderRentalOfferings();
    expect(offeringFindMany).toHaveBeenCalledTimes(1);
    expect(offeringFindMany.mock.calls[0]?.[0]?.where).toEqual({ service: { providerId: "prov-1" } });
  });

  it("maps offering fields, resolves the localized service name, and formats money as a 2dp string", async () => {
    offeringFindMany.mockResolvedValue([
      {
        id: "off-1",
        serviceId: "svc-1",
        vehicleId: "veh-1",
        status: "PUBLISHED",
        baseDailyAmount: dec("40.00"),
        currency: "OMR",
        offeringCapacityOverride: null,
        service: { name: { en: "Desert Safari 4x4", ar: "سفاري" } },
        vehicle: vehicle("veh-1"),
      },
    ]);
    dayFindMany.mockResolvedValue([
      { rentalOfferingId: "off-1", serviceDate: new Date("2030-07-12T00:00:00.000Z") },
      { rentalOfferingId: "off-1", serviceDate: new Date("2030-07-20T00:00:00.000Z") },
    ]);

    const [item] = await listProviderRentalOfferings();
    expect(item).toMatchObject({
      id: "off-1",
      status: "PUBLISHED",
      serviceName: "Desert Safari 4x4",
      vehicleTitle: "Toyota Land Cruiser",
      vehicleType: "SUV",
      bookablePassengerCapacity: 6,
      effectiveCapacity: 6,
      baseDailyAmount: "40.00",
      currency: "OMR",
      nearestConfiguredOpenDateKey: "2030-07-12", // earliest upcoming OPEN day
      readinessBlocker: null,
    });
  });

  it("applies the offering capacity override to effectiveCapacity", async () => {
    offeringFindMany.mockResolvedValue([
      { id: "o", serviceId: "s", vehicleId: "v", status: "DRAFT", baseDailyAmount: dec("10.00"), currency: "OMR", offeringCapacityOverride: 3, service: { name: { en: "S" } }, vehicle: vehicle("v") },
    ]);
    const [item] = await listProviderRentalOfferings();
    expect(item!.bookablePassengerCapacity).toBe(6);
    expect(item!.effectiveCapacity).toBe(3);
  });

  it("evaluates vertical compliance exactly ONCE for the whole list and applies it to every offering", async () => {
    assertVerticalMock.mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    offeringFindMany.mockResolvedValue([
      { id: "a", serviceId: "s", vehicleId: "v1", status: "DRAFT", baseDailyAmount: dec("10.00"), currency: "OMR", offeringCapacityOverride: null, service: { name: { en: "A" } }, vehicle: vehicle("v1") },
      { id: "b", serviceId: "s", vehicleId: "v2", status: "DRAFT", baseDailyAmount: dec("10.00"), currency: "OMR", offeringCapacityOverride: null, service: { name: { en: "B" } }, vehicle: vehicle("v2") },
    ]);
    const items = await listProviderRentalOfferings();
    expect(assertVerticalMock).toHaveBeenCalledTimes(1);
    expect(items.map((i) => i.readinessBlocker)).toEqual(["VERTICAL_NOT_COMPLIANT", "VERTICAL_NOT_COMPLIANT"]);
    // Vertical blocker takes precedence — per-vehicle readiness is not even consulted.
    expect(assertVehicleReadyMock).not.toHaveBeenCalled();
  });

  it("surfaces a per-vehicle readiness blocker when the vertical is compliant", async () => {
    assertVerticalMock.mockResolvedValue(null);
    assertVehicleReadyMock.mockImplementation((v: { assetId: string }) => (v.assetId === "v2" ? "VEHICLE_NOT_SELECTABLE" : null));
    offeringFindMany.mockResolvedValue([
      { id: "a", serviceId: "s", vehicleId: "v1", status: "PUBLISHED", baseDailyAmount: dec("10.00"), currency: "OMR", offeringCapacityOverride: null, service: { name: { en: "A" } }, vehicle: vehicle("v1") },
      { id: "b", serviceId: "s", vehicleId: "v2", status: "DRAFT", baseDailyAmount: dec("10.00"), currency: "OMR", offeringCapacityOverride: null, service: { name: { en: "B" } }, vehicle: vehicle("v2") },
    ]);
    const items = await listProviderRentalOfferings();
    expect(items.find((i) => i.id === "a")!.readinessBlocker).toBeNull();
    expect(items.find((i) => i.id === "b")!.readinessBlocker).toBe("VEHICLE_NOT_SELECTABLE");
  });

  it("returns [] without evaluating readiness when the provider has no offerings", async () => {
    offeringFindMany.mockResolvedValue([]);
    const items = await listProviderRentalOfferings();
    expect(items).toEqual([]);
    expect(assertVerticalMock).not.toHaveBeenCalled();
    expect(dayFindMany).not.toHaveBeenCalled();
  });

  it("propagates a ForbiddenError from the auth boundary (unapproved provider)", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no", "PROVIDER_NOT_APPROVED"));
    await expect(listProviderRentalOfferings()).rejects.toBeInstanceOf(ForbiddenError);
    expect(offeringFindMany).not.toHaveBeenCalled();
  });
});
