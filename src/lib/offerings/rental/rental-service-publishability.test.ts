import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

// Keep the validation + date helpers REAL; mock only the two authorization reads (each has its own
// suite) so this file pins the bridge's own composition/iteration/fail-closed logic.
vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return { ...actual, assertProviderStillApproved: vi.fn(), assertRentalPublishReady: vi.fn() };
});

import { Prisma } from "@prisma/client";
import { evaluateRentalServicePublishable } from "./rental-service-publishability";
import { assertProviderStillApproved, assertRentalPublishReady } from "./rental-offering-authorization";

const SERVICE = "svc-1";
const PROVIDER = "prov-1";

const vehicle = (over: Record<string, unknown> = {}) => ({
  assetId: "veh-1",
  bookablePassengerCapacity: 7,
  asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] },
  ...over,
});

const offering = (over: Record<string, unknown> = {}) => ({
  id: "off-1",
  baseDailyAmount: new Prisma.Decimal("40.00"),
  currency: "OMR",
  offeringCapacityOverride: null as number | null,
  vehicle: vehicle(),
  ...over,
});

type DbOver = {
  service?: unknown;
  offerings?: unknown[];
  openDay?: unknown;
};

function makeDb(over: DbOver = {}) {
  const serviceFindUnique = vi.fn().mockResolvedValue(over.service === undefined ? { providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" } : over.service);
  const offeringFindMany = vi.fn().mockResolvedValue(over.offerings ?? []);
  const dayFindFirst = vi.fn().mockResolvedValue(over.openDay === undefined ? { id: "day-1" } : over.openDay);
  const db = {
    service: { findUnique: serviceFindUnique },
    rentalOffering: { findMany: offeringFindMany },
    rentalOfferingDay: { findFirst: dayFindFirst },
  };
  return { db, serviceFindUnique, offeringFindMany, dayFindFirst };
}

beforeEach(() => {
  vi.clearAllMocks();
  (assertProviderStillApproved as Mock).mockResolvedValue(null); // provider APPROVED
  (assertRentalPublishReady as Mock).mockResolvedValue(null); // vertical + vehicle + capacity ready
});

const run = (dbOver: DbOver) => evaluateRentalServicePublishable(makeDb(dbOver).db as never, { serviceId: SERVICE, now: new Date("2030-06-15T08:00:00.000Z") });

describe("evaluateRentalServicePublishable — success (Path B)", () => {
  it("true when one PUBLISHED offering is fully ready with an OPEN future day (no legacy Price needed)", async () => {
    expect(await run({ offerings: [offering()] })).toBe(true);
  });
  it("true with a per-day override rate on the qualifying offering", async () => {
    expect(await run({ offerings: [offering({ offeringCapacityOverride: 4 })] })).toBe(true);
  });
  it("iterates: a later valid offering qualifies even if an earlier one is not ready", async () => {
    (assertRentalPublishReady as Mock).mockResolvedValueOnce("VEHICLE_NOT_SELECTABLE").mockResolvedValueOnce(null);
    expect(await run({ offerings: [offering({ id: "bad" }), offering({ id: "good" })] })).toBe(true);
  });
});

describe("evaluateRentalServicePublishable — fail-closed", () => {
  it("false when the service does not resolve to VEHICLE_RENTAL", async () => {
    expect(await run({ service: { providerId: PROVIDER, offeringKind: "TOUR" } })).toBe(false);
  });
  it("false when the service row is missing", async () => {
    expect(await run({ service: null })).toBe(false);
  });
  it("false when the provider is no longer APPROVED", async () => {
    (assertProviderStillApproved as Mock).mockResolvedValue("PROVIDER_NOT_APPROVED");
    expect(await run({ offerings: [offering()] })).toBe(false);
  });
  it("false when there are no PUBLISHED offerings", async () => {
    expect(await run({ offerings: [] })).toBe(false);
  });
  it("false when the only offering fails publish-readiness (vertical/vehicle/capacity)", async () => {
    (assertRentalPublishReady as Mock).mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    expect(await run({ offerings: [offering()] })).toBe(false);
  });
  it("false when the base daily amount is not a valid positive money", async () => {
    expect(await run({ offerings: [offering({ baseDailyAmount: new Prisma.Decimal("0") })] })).toBe(false);
  });
  it("false when the currency is empty/invalid", async () => {
    expect(await run({ offerings: [offering({ currency: "" })] })).toBe(false);
  });
  it("false when the capacity override exceeds verified capacity", async () => {
    expect(await run({ offerings: [offering({ offeringCapacityOverride: 8 })] })).toBe(false); // verified is 7
  });
  it("false when no OPEN non-past day exists", async () => {
    expect(await run({ offerings: [offering()], openDay: null })).toBe(false);
  });
});

describe("evaluateRentalServicePublishable — query scoping", () => {
  it("scopes offerings to serviceId + PUBLISHED + provider-owned vehicle (foreign vehicle/service cannot match)", async () => {
    const m = makeDb({ offerings: [offering()] });
    await evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: new Date("2030-06-15T08:00:00.000Z") });
    expect(m.offeringFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceId: SERVICE,
          status: "PUBLISHED",
          vehicle: { asset: { providerId: PROVIDER, assetType: "VEHICLE" } },
        }),
      }),
    );
  });
});
