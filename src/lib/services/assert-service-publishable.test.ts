import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const priceFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { price: { findFirst: (...args: unknown[]) => priceFindFirstMock(...args) } },
}));

// TOUR-VEHICLE-2P — the tour vehicle publish check is its own tested authority; here it
// is mocked so this suite pins how assertServicePublishable ORDERS/appends its blockers.
const tourVehicleBlockerMock = vi.fn();
vi.mock("@/lib/tour-template/vehicle-pool/publish-readiness", () => ({
  getTourVehiclePublishBlocker: (...args: unknown[]) => tourVehicleBlockerMock(...args),
}));

// C2b-R2 — the daily-rental Service publication bridge (Path B) is its own tested authority; mocked
// here so this suite pins how assertServicePublishable chooses Path A vs Path B for the price rule.
const rentalDailyMock = vi.fn();
vi.mock("@/lib/offerings/rental/rental-service-publishability", () => ({
  evaluateRentalServicePublishable: (...args: unknown[]) => rentalDailyMock(...args),
}));

const { assertServicePublishable } = await import("./assert-service-publishable");

const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const svc = (categoryId: string | null) => ({ id: ID, categoryId, providerId: "prov-1" });
const rentalSvc = (categoryId: string | null) => ({ id: ID, categoryId, providerId: "prov-1", offeringKind: "VEHICLE_RENTAL" as const });

afterEach(() => {
  priceFindFirstMock.mockReset();
  tourVehicleBlockerMock.mockReset();
  rentalDailyMock.mockReset();
});

describe("assertServicePublishable", () => {
  it("returns no blockers when categorized and priced (non-tour → no vehicle blocker)", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc("cat-1"))).toEqual([]);
  });

  it("returns both blockers, category first, when uncategorized and priceless", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc(null))).toEqual(["SERVICE_CATEGORY_REQUIRED", "NO_ACTIVE_PRICE"]);
  });

  it("returns only the category blocker when priced but uncategorized", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc(null))).toEqual(["SERVICE_CATEGORY_REQUIRED"]);
  });

  it("returns only the price blocker when categorized but priceless", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc("cat-1"))).toEqual(["NO_ACTIVE_PRICE"]);
  });

  it("TOUR-VEHICLE-2P — appends TOUR_VEHICLE_POOL_REQUIRED last (after category + price)", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    tourVehicleBlockerMock.mockResolvedValue("TOUR_VEHICLE_POOL_REQUIRED");
    // Categorized + priced transport tour missing an eligible vehicle → only the vehicle blocker.
    expect(await assertServicePublishable(svc("cat-1"))).toEqual(["TOUR_VEHICLE_POOL_REQUIRED"]);
    // The vehicle check is scoped to the service + its provider (ownership already enforced upstream).
    expect(tourVehicleBlockerMock).toHaveBeenCalledWith({ id: ID, providerId: "prov-1" });

    // With every gate failing, order is category → price → vehicle.
    priceFindFirstMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc(null))).toEqual([
      "SERVICE_CATEGORY_REQUIRED",
      "NO_ACTIVE_PRICE",
      "TOUR_VEHICLE_POOL_REQUIRED",
    ]);
  });
});

describe("assertServicePublishable — C2b-R2 daily-rental price bridge (Path A / Path B)", () => {
  it("VEHICLE_RENTAL with no ACTIVE Price but a valid PUBLISHED daily offering → NO price blocker (Path B)", async () => {
    priceFindFirstMock.mockResolvedValue(null); // Path A absent
    tourVehicleBlockerMock.mockResolvedValue(null);
    rentalDailyMock.mockResolvedValue(true); // Path B satisfied
    expect(await assertServicePublishable(rentalSvc("cat-1"))).toEqual([]);
    expect(rentalDailyMock).toHaveBeenCalledWith(expect.anything(), { serviceId: ID, now: expect.any(Date) });
  });

  it("VEHICLE_RENTAL with neither ACTIVE Price nor a publishable daily offering → NO_ACTIVE_PRICE (fail-closed)", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    tourVehicleBlockerMock.mockResolvedValue(null);
    rentalDailyMock.mockResolvedValue(false);
    expect(await assertServicePublishable(rentalSvc("cat-1"))).toEqual(["NO_ACTIVE_PRICE"]);
  });

  it("VEHICLE_RENTAL WITH an ACTIVE legacy Price publishes via Path A — the daily bridge is never consulted", async () => {
    priceFindFirstMock.mockResolvedValue({ id: "price-1" });
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(rentalSvc("cat-1"))).toEqual([]);
    expect(rentalDailyMock).not.toHaveBeenCalled();
  });

  it("a NON-rental service with no ACTIVE Price still fails NO_ACTIVE_PRICE — the bridge is never consulted", async () => {
    priceFindFirstMock.mockResolvedValue(null);
    tourVehicleBlockerMock.mockResolvedValue(null);
    expect(await assertServicePublishable(svc("cat-1"))).toEqual(["NO_ACTIVE_PRICE"]); // no offeringKind
    expect(rentalDailyMock).not.toHaveBeenCalled();
  });
});
