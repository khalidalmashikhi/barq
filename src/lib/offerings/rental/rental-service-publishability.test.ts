import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

// Keep validation + date helpers REAL; mock only the authorization reads (each has its own suite) so
// this file pins the bridge's own global-vs-candidate-local composition + iteration + fail-closed logic.
vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return {
    ...actual,
    assertProviderStillApproved: vi.fn(), // provider-global
    assertRentalVerticalCompliant: vi.fn(), // provider-global (evaluated ONCE)
    assertRentalVehicleReady: vi.fn(), // candidate-local (per offering)
  };
});

import { Prisma } from "@prisma/client";
import { evaluateRentalServicePublishable, RENTAL_SERVICE_PUBLISH_CANDIDATE_LIMIT } from "./rental-service-publishability";
import { assertProviderStillApproved, assertRentalVerticalCompliant, assertRentalVehicleReady } from "./rental-offering-authorization";

const SERVICE = "svc-1";
const PROVIDER = "prov-1";
const NOW = new Date("2030-06-15T08:00:00.000Z");

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
  /** ids of offerings that HAVE a qualifying OPEN non-past day; default: all do. */
  openDayFor?: Set<string>;
};

function makeDb(over: DbOver = {}) {
  const serviceFindUnique = vi.fn().mockResolvedValue(over.service === undefined ? { providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" } : over.service);
  const offeringFindMany = vi.fn().mockResolvedValue(over.offerings ?? []);
  const dayFindFirst = vi.fn().mockImplementation((args: { where: { rentalOfferingId: string } }) => {
    const id = args?.where?.rentalOfferingId;
    const has = over.openDayFor ? over.openDayFor.has(id) : true;
    return Promise.resolve(has ? { id: `day-${id}` } : null);
  });
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
  (assertRentalVerticalCompliant as Mock).mockResolvedValue(null); // vertical APPROVED + compliant
  (assertRentalVehicleReady as Mock).mockReturnValue(null); // vehicle selectable + capacity ok
});

const run = (dbOver: DbOver) => evaluateRentalServicePublishable(makeDb(dbOver).db as never, { serviceId: SERVICE, now: NOW });

describe("evaluateRentalServicePublishable — success (Path B)", () => {
  it("true when one PUBLISHED offering is fully ready with an OPEN future day (no legacy Price needed)", async () => {
    expect(await run({ offerings: [offering()] })).toBe(true);
  });
  it("true with a per-day override rate / capacity override on the qualifying offering", async () => {
    expect(await run({ offerings: [offering({ offeringCapacityOverride: 4 })] })).toBe(true);
  });
});

describe("evaluateRentalServicePublishable — provider/service-GLOBAL failures (fail the whole evaluation)", () => {
  it("false when the service does not resolve to VEHICLE_RENTAL", async () => {
    expect(await run({ service: { providerId: PROVIDER, offeringKind: "TOUR" }, offerings: [offering()] })).toBe(false);
  });
  it("false when the service row is missing", async () => {
    expect(await run({ service: null, offerings: [offering()] })).toBe(false);
  });
  it("false when the provider is no longer APPROVED — offerings are never even loaded", async () => {
    (assertProviderStillApproved as Mock).mockResolvedValue("PROVIDER_NOT_APPROVED");
    const m = makeDb({ offerings: [offering()] });
    expect(await evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: NOW })).toBe(false);
    expect(m.offeringFindMany).not.toHaveBeenCalled();
  });
  it("false when the rental vertical is not compliant — evaluated ONCE, offerings never loaded (no N+1)", async () => {
    (assertRentalVerticalCompliant as Mock).mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    const m = makeDb({ offerings: [offering({ id: "a" }), offering({ id: "b" })] });
    expect(await evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: NOW })).toBe(false);
    expect(assertRentalVerticalCompliant).toHaveBeenCalledTimes(1);
    expect(m.offeringFindMany).not.toHaveBeenCalled();
    expect(assertRentalVehicleReady).not.toHaveBeenCalled();
  });
});

describe("evaluateRentalServicePublishable — CANDIDATE-LOCAL failures (disqualify only that offering)", () => {
  it("false when there are no PUBLISHED offerings", async () => {
    expect(await run({ offerings: [] })).toBe(false);
  });
  it("false when the only offering's vehicle is not selectable", async () => {
    (assertRentalVehicleReady as Mock).mockReturnValue("VEHICLE_NOT_SELECTABLE");
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
  it("false when the only offering has no OPEN non-past day", async () => {
    expect(await run({ offerings: [offering({ id: "x" })], openDayFor: new Set() })).toBe(false);
  });
});

describe("evaluateRentalServicePublishable — multi-candidate 'at least one valid' semantics", () => {
  it("invalid first (vehicle) + valid second → true", async () => {
    (assertRentalVehicleReady as Mock).mockReturnValueOnce("VEHICLE_NOT_SELECTABLE").mockReturnValue(null);
    expect(await run({ offerings: [offering({ id: "bad" }), offering({ id: "good" })] })).toBe(true);
  });
  it("valid first + invalid second → true (returns on the first valid)", async () => {
    (assertRentalVehicleReady as Mock).mockReturnValueOnce(null).mockReturnValue("VEHICLE_NOT_SELECTABLE");
    expect(await run({ offerings: [offering({ id: "good" }), offering({ id: "bad" })] })).toBe(true);
  });
  it("one candidate with only past/BLOCKED days + another with a valid OPEN day → true", async () => {
    // 'noday' has no qualifying OPEN day; 'good' does.
    expect(await run({ offerings: [offering({ id: "noday" }), offering({ id: "good" })], openDayFor: new Set(["good"]) })).toBe(true);
  });
  it("all candidates invalid → false", async () => {
    (assertRentalVehicleReady as Mock).mockReturnValue("VEHICLE_NOT_SELECTABLE");
    expect(await run({ offerings: [offering({ id: "a" }), offering({ id: "b" }), offering({ id: "c" })] })).toBe(false);
  });
  it("result is independent of DB return order (∃ one valid → true either way)", async () => {
    const bad = offering({ id: "bad", currency: "" }); // candidate-local invalid (currency)
    const good = offering({ id: "good" });
    expect(await run({ offerings: [bad, good] })).toBe(true);
    expect(await run({ offerings: [good, bad] })).toBe(true);
  });
});

describe("evaluateRentalServicePublishable — bounded, deterministic query", () => {
  it("scopes to serviceId + PUBLISHED + provider-owned vehicle, orders deterministically, and caps the candidate set", async () => {
    const m = makeDb({ offerings: [offering()] });
    await evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: NOW });
    expect(m.offeringFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceId: SERVICE,
          status: "PUBLISHED",
          vehicle: { asset: { providerId: PROVIDER, assetType: "VEHICLE" } },
        }),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: RENTAL_SERVICE_PUBLISH_CANDIDATE_LIMIT,
      }),
    );
    // start-time rows are irrelevant to Service publication and must never be selected.
    const selectArg = (m.offeringFindMany.mock.calls[0]![0] as { select: Record<string, unknown> }).select;
    expect(selectArg).not.toHaveProperty("startTimes");
    expect(selectArg.vehicle).toBeDefined();
  });
});
