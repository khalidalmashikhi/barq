import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const serviceFindMany = vi.fn();
const vehicleFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { service: { findMany: (...a: unknown[]) => serviceFindMany(...a) }, vehicle: { findMany: (...a: unknown[]) => vehicleFindMany(...a) } },
}));

const assertVehicleReadyMock = vi.fn();
vi.mock("../rental-offering-authorization", () => ({
  RENTAL_VEHICLE_SELECT: {},
  assertRentalVehicleReady: (...a: unknown[]) => assertVehicleReadyMock(...a),
}));

const { getRentalCreateOptions } = await import("./get-rental-create-options");

const vehicle = (assetId: string, over: Record<string, unknown> = {}) => ({
  assetId, bookablePassengerCapacity: 6, make: "Toyota", model: "Hiace", modelYear: 2029, color: "White",
  vehicleType: "VAN", registeredSeats: 12, asset: { providerId: "prov-1", assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] }, ...over,
});

beforeEach(() => {
  requireApprovedProviderMock.mockReset().mockResolvedValue({ provider: { id: "prov-1" } });
  serviceFindMany.mockReset();
  vehicleFindMany.mockReset();
  assertVehicleReadyMock.mockReset().mockReturnValue(null);
});

describe("getRentalCreateOptions", () => {
  it("lists the provider's own VEHICLE_RENTAL services and own vehicles (server-derived, not category-based)", async () => {
    serviceFindMany.mockResolvedValue([{ id: "svc-1", name: { en: "Airport Rental", ar: "تأجير المطار" } }]);
    vehicleFindMany.mockResolvedValue([vehicle("veh-1")]);

    const options = await getRentalCreateOptions();
    expect(options.services).toEqual([{ serviceId: "svc-1", serviceName: "Airport Rental" }]);
    expect(options.vehicles[0]).toMatchObject({ vehicleId: "veh-1", title: "Toyota Hiace", vehicleType: "VAN", bookablePassengerCapacity: 6, registeredSeats: 12, ready: true, readinessBlocker: null });

    // Eligibility gates: services by offeringKind VEHICLE_RENTAL + owner; vehicles by owner + VEHICLE asset.
    expect(serviceFindMany.mock.calls[0]?.[0]?.where).toEqual({ providerId: "prov-1", offeringKind: "VEHICLE_RENTAL" });
    expect(vehicleFindMany.mock.calls[0]?.[0]?.where).toEqual({ asset: { providerId: "prov-1", assetType: "VEHICLE" } });
  });

  it("flags an unready vehicle informationally (still selectable — readiness is a publish requirement)", async () => {
    serviceFindMany.mockResolvedValue([]);
    vehicleFindMany.mockResolvedValue([vehicle("veh-2")]);
    assertVehicleReadyMock.mockReturnValue("VEHICLE_NOT_SELECTABLE");
    const options = await getRentalCreateOptions();
    expect(options.vehicles[0]).toMatchObject({ vehicleId: "veh-2", ready: false, readinessBlocker: "VEHICLE_NOT_SELECTABLE" });
  });

  it("propagates a ForbiddenError from the auth boundary", async () => {
    requireApprovedProviderMock.mockRejectedValue(new ForbiddenError("no", "PROVIDER_NOT_APPROVED"));
    await expect(getRentalCreateOptions()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
