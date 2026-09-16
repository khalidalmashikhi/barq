import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Keep validation REAL; mock the provider-global authorization reads + the candidate-local vehicle
// check (each has its own suite) so this file pins the bridge's pagination / overflow / global-vs-
// candidate-local composition. Candidate-local validity is driven by the vehicle's assetId prefix
// ("bad-" ⇒ not selectable) and by the offering's money/currency (real validators).
vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return {
    ...actual,
    assertProviderStillApproved: vi.fn(),
    assertRentalVerticalCompliant: vi.fn(),
    assertRentalVehicleReady: vi.fn((vehicle: { assetId: string }) => (vehicle.assetId.startsWith("bad-") ? "VEHICLE_NOT_SELECTABLE" : null)),
  };
});

import { Prisma } from "@prisma/client";
import {
  evaluateRentalServicePublishable,
  RENTAL_SERVICE_PUBLISH_PAGE_SIZE,
  MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES,
} from "./rental-service-publishability";
import { assertProviderStillApproved, assertRentalVerticalCompliant, assertRentalVehicleReady } from "./rental-offering-authorization";
import { logger } from "@/lib/logger";

const SERVICE = "svc-1";
const PROVIDER = "prov-1";
const NOW = new Date("2030-06-15T08:00:00.000Z");
const pad = (n: number) => `off-${String(n).padStart(5, "0")}`;

type Row = { id: string; baseDailyAmount: Prisma.Decimal; currency: string; offeringCapacityOverride: number | null; vehicle: { assetId: string; bookablePassengerCapacity: number; asset: Record<string, unknown> } };

// A candidate offering. `valid` ⇒ good vehicle + valid money/currency; otherwise a bad vehicle.
function row(n: number, valid: boolean): Row {
  const assetId = `${valid ? "good" : "bad"}-${pad(n)}`;
  return {
    id: pad(n),
    baseDailyAmount: new Prisma.Decimal("40.00"),
    currency: "OMR",
    offeringCapacityOverride: null,
    vehicle: { assetId, bookablePassengerCapacity: 7, asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] } },
  };
}

// A fake db over an in-memory offering list with keyset paging, a batched distinct day query, and the
// overflow probe. `hasDayFor` = offering ids that own a qualifying OPEN non-past day (default: all valid).
function makeDb(rows: Row[], hasDayFor?: Set<string>) {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dayIds = hasDayFor ?? new Set(sorted.map((r) => r.id));
  const findMany = vi.fn(async (args: { where: { id?: { gt?: string } }; take: number }) => {
    const gt = args.where.id?.gt;
    const rowsAfter = gt === undefined ? sorted : sorted.filter((r) => r.id > gt);
    return rowsAfter.slice(0, args.take);
  });
  const dayFindMany = vi.fn(async (args: { where: { rentalOfferingId: { in: string[] } } }) =>
    args.where.rentalOfferingId.in.filter((id) => dayIds.has(id)).map((id) => ({ rentalOfferingId: id })),
  );
  const findFirst = vi.fn(async (args: { where: { id: { gt: string } } }) => {
    const r = sorted.find((x) => x.id > args.where.id.gt);
    return r ? { id: r.id } : null;
  });
  const db = {
    service: { findUnique: vi.fn().mockResolvedValue({ providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" }) },
    rentalOffering: { findMany, findFirst },
    rentalOfferingDay: { findMany: dayFindMany },
  };
  return { db, findMany, dayFindMany, findFirst };
}

const run = (rows: Row[], hasDayFor?: Set<string>) => {
  const m = makeDb(rows, hasDayFor);
  return { m, result: evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: NOW }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  (assertProviderStillApproved as Mock).mockResolvedValue(null);
  (assertRentalVerticalCompliant as Mock).mockResolvedValue(null);
  (assertRentalVehicleReady as Mock).mockImplementation((vehicle: { assetId: string }) => (vehicle.assetId.startsWith("bad-") ? "VEHICLE_NOT_SELECTABLE" : null));
});

describe("evaluateRentalServicePublishable — success / basic fail-closed", () => {
  it("valid candidate on the first page → publishable", async () => {
    expect(await run([row(1, true)]).result).toEqual({ publishable: true });
  });
  it("no PUBLISHED offerings → NO_CANDIDATE", async () => {
    expect(await run([]).result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
  });
  it("single candidate whose vehicle is not selectable → NO_CANDIDATE", async () => {
    expect(await run([row(1, false)]).result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
  });
  it("candidate valid but no qualifying OPEN day → NO_CANDIDATE", async () => {
    expect(await run([row(1, true)], new Set()).result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
  });
  it("invalid money disqualifies the candidate (candidate-local) → NO_CANDIDATE", async () => {
    const r = row(1, true);
    r.baseDailyAmount = new Prisma.Decimal("0");
    expect(await run([r]).result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
  });
});

describe("evaluateRentalServicePublishable — provider/service-GLOBAL failures stop before pagination", () => {
  it("provider not approved → NO_CANDIDATE, offerings never queried", async () => {
    (assertProviderStillApproved as Mock).mockResolvedValue("PROVIDER_NOT_APPROVED");
    const { m, result } = run([row(1, true)]);
    expect(await result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
    expect(m.findMany).not.toHaveBeenCalled();
  });
  it("vertical not compliant → NO_CANDIDATE, offerings never queried (evaluated once)", async () => {
    (assertRentalVerticalCompliant as Mock).mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    const { m, result } = run([row(1, true), row(2, true)]);
    expect(await result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
    expect(assertRentalVerticalCompliant).toHaveBeenCalledTimes(1);
    expect(m.findMany).not.toHaveBeenCalled();
  });
  it("service not VEHICLE_RENTAL → NO_CANDIDATE", async () => {
    const m = makeDb([row(1, true)]);
    m.db.service.findUnique.mockResolvedValue({ providerId: PROVIDER, offeringKind: "TOUR" });
    expect(await evaluateRentalServicePublishable(m.db as never, { serviceId: SERVICE, now: NOW })).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
  });
});

describe("evaluateRentalServicePublishable — pagination beyond the first page (position-independent)", () => {
  it("first FULL page all invalid, a valid candidate on the second page → publishable", async () => {
    const rows = [...Array(RENTAL_SERVICE_PUBLISH_PAGE_SIZE)].map((_, i) => row(i + 1, false));
    rows.push(row(RENTAL_SERVICE_PUBLISH_PAGE_SIZE + 5, true)); // page 2
    expect(await run(rows).result).toEqual({ publishable: true });
  });

  it("a valid candidate at position 101 (past the OLD take:100 truncation) → publishable", async () => {
    const rows = [...Array(100)].map((_, i) => row(i + 1, false));
    rows.push(row(101, true));
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: true });
    expect(m.findMany.mock.calls.length).toBeGreaterThanOrEqual(3); // 50 + 50 + the page holding #101
  });

  it("result is independent of candidate ordering (valid id early vs late)", async () => {
    const early = [row(1, true), ...[...Array(60)].map((_, i) => row(i + 2, false))];
    const late = [...[...Array(60)].map((_, i) => row(i + 1, false)), row(999, true)];
    expect(await run(early).result).toEqual({ publishable: true });
    expect(await run(late).result).toEqual({ publishable: true });
  });

  it("keyset cursor advances strictly (no duplicate/skipped candidate) — each page's id.gt is the previous page's last id", async () => {
    const rows = [...Array(120)].map((_, i) => row(i + 1, false)); // 3 pages: 50, 50, 20 → NO_CANDIDATE
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
    const gts = m.findMany.mock.calls.map((c) => (c[0] as { where: { id?: { gt?: string } } }).where.id?.gt);
    expect(gts[0]).toBeUndefined(); // first page: no cursor
    expect(gts[1]).toBe(pad(50)); // second page starts strictly after id #50
    expect(gts[2]).toBe(pad(100)); // third page starts strictly after id #100
  });

  it("last partial page with no valid candidate → NO_CANDIDATE", async () => {
    const rows = [...Array(70)].map((_, i) => row(i + 1, false)); // 50 + 20 (partial)
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
    expect(m.findMany).toHaveBeenCalledTimes(2);
    expect(m.findFirst).not.toHaveBeenCalled(); // exhausted by partial page, no overflow probe
  });
});

describe("evaluateRentalServicePublishable — safety ceiling / overflow", () => {
  it("EXACTLY the ceiling with no more rows → NO_CANDIDATE (full set was scanned)", async () => {
    const rows = [...Array(MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES)].map((_, i) => row(i + 1, false));
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: false, reason: "NO_CANDIDATE" });
    expect(m.findFirst).toHaveBeenCalledTimes(1); // probed for a row beyond the ceiling → none
    expect(logger.warn as Mock).not.toHaveBeenCalled();
  });

  it("MORE than the ceiling of invalid candidates → CANDIDATE_LIMIT_EXCEEDED (does NOT publish, logs bounded metadata)", async () => {
    const rows = [...Array(MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES + 5)].map((_, i) => row(i + 1, false));
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: false, reason: "CANDIDATE_LIMIT_EXCEEDED" });
    expect(m.findFirst).toHaveBeenCalledTimes(1);
    expect(logger.warn as Mock).toHaveBeenCalledWith(
      "rental_service_publishable.candidate_limit_exceeded",
      expect.objectContaining({ serviceId: SERVICE, inspected: MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES }),
    );
  });

  it("a valid candidate WITHIN the ceiling short-circuits before overflow (no probe)", async () => {
    const rows = [...Array(MAX_RENTAL_SERVICE_PUBLISH_CANDIDATES + 50)].map((_, i) => row(i + 1, false));
    rows.push(row(5, true)); // id sorts near the front → found on the first page
    const { m, result } = run(rows);
    expect(await result).toEqual({ publishable: true });
    expect(m.findFirst).not.toHaveBeenCalled();
  });
});

describe("evaluateRentalServicePublishable — bounded, N+1-free day check + no start-times", () => {
  it("day existence is ONE batched distinct query per page (not per candidate); start-times are never selected", async () => {
    const rows = [row(1, true), row(2, true), row(3, true)];
    const { m, result } = run(rows, new Set([pad(3)])); // only #3 has a day
    expect(await result).toEqual({ publishable: true });
    // one page → at most one batched day query, scoped to the page's ready ids, distinct on offering id.
    expect(m.dayFindMany).toHaveBeenCalledTimes(1);
    const dayArg = m.dayFindMany.mock.calls[0]![0] as unknown as { where: Record<string, unknown>; select: Record<string, unknown>; distinct: string[] };
    expect(dayArg.where).toMatchObject({ rentalOfferingId: { in: [pad(1), pad(2), pad(3)] }, state: "OPEN" });
    expect(dayArg.distinct).toEqual(["rentalOfferingId"]);
    expect(dayArg.select).toEqual({ rentalOfferingId: true });
    // the offering select never loads start-times or day history.
    const offArg = m.findMany.mock.calls[0]![0] as unknown as { select: Record<string, unknown> };
    expect(offArg.select).not.toHaveProperty("startTimes");
    expect(offArg.select).not.toHaveProperty("days");
  });

  it("scopes candidates to serviceId + PUBLISHED + provider-owned vehicle, ordered by unique id", async () => {
    const { m, result } = run([row(1, true)]);
    await result;
    expect(m.findMany.mock.calls[0]![0]).toMatchObject({
      where: { serviceId: SERVICE, status: "PUBLISHED", vehicle: { asset: { providerId: PROVIDER, assetType: "VEHICLE" } } },
      orderBy: { id: "asc" },
      take: RENTAL_SERVICE_PUBLISH_PAGE_SIZE,
    });
  });
});
