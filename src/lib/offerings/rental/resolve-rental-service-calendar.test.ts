import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Keep the validators + Oman-date + calendar contract REAL; mock only the two authorization reads
// (each has its own suite) so this file pins the resolver's window/eligibility/day-resolution logic.
vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return {
    ...actual,
    assertRentalVerticalCompliant: vi.fn(), // provider-global
    assertRentalVehicleReady: vi.fn(), // candidate-local
  };
});

import { Prisma } from "@prisma/client";
import { dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import {
  resolveRentalServiceCalendar,
  MAX_RENTAL_CALENDAR_OFFERINGS,
  MAX_RENTAL_CALENDAR_CANDIDATES,
  RENTAL_CALENDAR_PAGE_SIZE,
} from "./resolve-rental-service-calendar";
import { assertRentalVerticalCompliant, assertRentalVehicleReady } from "./rental-offering-authorization";

const SERVICE = "svc-1";
const PROVIDER = "prov-1";
const NOW = new Date("2030-06-15T08:00:00.000Z"); // Oman 2030-06-15 12:00

const vehicle = (assetId = "good-1", capacity = 7) => ({
  assetId,
  bookablePassengerCapacity: capacity,
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2028,
  color: "white",
  vehicleType: "FOUR_BY_FOUR",
  asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] },
});
const offering = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  baseDailyAmount: new Prisma.Decimal("40.00"),
  currency: "OMR",
  offeringCapacityOverride: null as number | null,
  vehicle: vehicle(`good-${id}`),
  ...over,
});
type DayRow = { rentalOfferingId: string; serviceDate: Date; state: "OPEN" | "BLOCKED"; dailyAmountOverride: Prisma.Decimal | null };
const day = (offeringId: string, key: string, state: "OPEN" | "BLOCKED", override: string | null = null): DayRow => ({
  rentalOfferingId: offeringId,
  serviceDate: dbDateFromOmanDateKey(key)!,
  state,
  dailyAmountOverride: override === null ? null : new Prisma.Decimal(override),
});

type CandidateRow = { id: string };
type DbOver = {
  service?: unknown; // undefined → default public rental service; null → not public
  candidates?: CandidateRow[];
  dayRows?: DayRow[];
  throwOn?: "service" | "offerings" | "days";
};
// The fake db implements REAL deterministic keyset pagination (order by id, id > cursor, take) + the
// overflow-probe findFirst, so pagination/overflow behavior is exercised for real.
function makeDb(over: DbOver = {}) {
  const sorted = [...(over.candidates ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const serviceFindFirst = vi.fn(async () => {
    if (over.throwOn === "service") throw new Error("db down");
    return over.service === undefined ? { providerId: PROVIDER, offeringKind: "VEHICLE_RENTAL" } : over.service;
  });
  const offeringFindMany = vi.fn(async (args: { where: { id?: { gt?: string } }; take: number }) => {
    if (over.throwOn === "offerings") throw new Error("db down");
    const gt = args.where.id?.gt;
    const rows = gt === undefined ? sorted : sorted.filter((c) => c.id > gt);
    return rows.slice(0, args.take);
  });
  const offeringFindFirst = vi.fn(async (args: { where: { id: { gt: string } } }) => {
    const r = sorted.find((c) => c.id > args.where.id.gt);
    return r ? { id: r.id } : null;
  });
  const dayFindMany = vi.fn(async (args: { where: { rentalOfferingId: { in: string[] }; serviceDate: { gte: Date; lte: Date } } }) => {
    if (over.throwOn === "days") throw new Error("db down");
    const ids = new Set(args.where.rentalOfferingId.in);
    const { gte, lte } = args.where.serviceDate;
    return (over.dayRows ?? []).filter((r) => ids.has(r.rentalOfferingId) && r.serviceDate >= gte && r.serviceDate <= lte);
  });
  const db = {
    service: { findFirst: serviceFindFirst },
    rentalOffering: { findMany: offeringFindMany, findFirst: offeringFindFirst },
    rentalOfferingDay: { findMany: dayFindMany },
  };
  return { db, serviceFindFirst, offeringFindMany, offeringFindFirst, dayFindMany };
}

const run = (over: DbOver, params: { from?: string; to?: string } = {}) => {
  const m = makeDb(over);
  return { m, result: resolveRentalServiceCalendar(m.db as never, { serviceId: SERVICE, now: NOW, ...params }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  (assertRentalVerticalCompliant as Mock).mockResolvedValue(null);
  (assertRentalVehicleReady as Mock).mockImplementation((v: { assetId: string }) => (v.assetId.startsWith("bad-") ? "VEHICLE_NOT_SELECTABLE" : null));
});

describe("window validation", () => {
  it("valid one-day window", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN")] }, { from: "2030-07-01", to: "2030-07-01" }).result;
    expect(r.ok && r.calendar.window).toEqual({ from: "2030-07-01", to: "2030-07-01", timeZone: "Asia/Muscat" });
    expect(r.ok && r.calendar.offerings[0]!.days).toHaveLength(1);
  });
  it("valid multi-day window", async () => {
    const r = await run({ candidates: [offering("o1")] }, { from: "2030-07-01", to: "2030-07-05" }).result;
    expect(r.ok && r.calendar.offerings[0]!.days).toHaveLength(5);
  });
  it("exactly 62 days is allowed", async () => {
    const r = await run({ candidates: [offering("o1")] }, { from: "2030-07-01", to: "2030-08-31" }).result; // 31+31=62
    expect(r.ok && r.calendar.offerings[0]!.days).toHaveLength(62);
  });
  it("more than 62 days is rejected (INVALID_WINDOW)", async () => {
    expect(await run({}, { from: "2030-07-01", to: "2030-09-01" }).result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });
  it("from > to is rejected", async () => {
    expect(await run({}, { from: "2030-07-05", to: "2030-07-01" }).result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });
  it("invalid format / rollover dates rejected", async () => {
    expect(await run({}, { from: "2030-7-1", to: "2030-07-05" }).result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
    expect(await run({}, { from: "2030-02-30", to: "2030-03-02" }).result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });
  it("exactly one bound supplied is invalid (no silent half-window)", async () => {
    expect(await run({}, { from: "2030-07-01" }).result).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });
  it("leap-day window is valid (2028-02-29)", async () => {
    const r = await run({ candidates: [offering("o1")] }, { from: "2028-02-28", to: "2028-03-01" }).result;
    expect(r.ok && r.calendar.offerings[0]!.days.map((d) => d.dateKey)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
  it("omitting both bounds uses the default window starting at Oman today", async () => {
    const r = await run({ candidates: [offering("o1")] }).result;
    expect(r.ok && r.calendar.window.from).toBe("2030-06-15");
    expect(r.ok && r.calendar.offerings[0]!.days).toHaveLength(32);
  });
});

describe("global public-visibility gate (fail-closed, non-enumerating)", () => {
  it("non-public service → NOT_PUBLIC", async () => {
    expect(await run({ service: null }).result).toEqual({ ok: false, reason: "NOT_PUBLIC" });
  });
  it("public but non-rental service → NOT_PUBLIC", async () => {
    expect(await run({ service: { providerId: PROVIDER, offeringKind: "TOUR" } }).result).toEqual({ ok: false, reason: "NOT_PUBLIC" });
  });
  it("service query enforces PUBLISHED + APPROVED, visible provider", async () => {
    const { m, result } = run({ candidates: [offering("o1")] }, { from: "2030-07-01", to: "2030-07-01" });
    await result;
    expect((m.serviceFindFirst.mock.calls[0]! as unknown[])[0]).toMatchObject({
      where: { id: SERVICE, status: "PUBLISHED", provider: { status: "APPROVED", visible: true } },
    });
  });
});

describe("eligibility + isolation (empty calendar, cause never revealed)", () => {
  it("vertical not compliant → empty offerings (no cause revealed), still ok/200", async () => {
    (assertRentalVerticalCompliant as Mock).mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    const { m, result } = run({ candidates: [offering("o1")] });
    const r = await result;
    expect(r.ok && r.calendar.offerings).toEqual([]);
    expect(r.ok && r.calendar.lowestAvailableDailyRate).toBeNull();
    expect(m.offeringFindMany).not.toHaveBeenCalled(); // global vertical fails before candidate load
  });
  it("candidate query scopes to serviceId + PUBLISHED + provider-owned vehicle, bounded + ordered", async () => {
    const { m, result } = run({ candidates: [offering("o1")] }, { from: "2030-07-01", to: "2030-07-01" });
    await result;
    expect((m.offeringFindMany.mock.calls[0]! as unknown[])[0]).toMatchObject({
      where: { serviceId: SERVICE, status: "PUBLISHED", vehicle: { asset: { providerId: PROVIDER, assetType: "VEHICLE" } } },
      orderBy: { id: "asc" },
      take: RENTAL_CALENDAR_PAGE_SIZE,
    });
  });
  it("a non-selectable vehicle disqualifies only its own offering; a valid later one still appears", async () => {
    const r = await run(
      { candidates: [offering("o1", { vehicle: vehicle("bad-1") }), offering("o2")], dayRows: [day("o2", "2030-07-01", "OPEN")] },
      { from: "2030-07-01", to: "2030-07-01" },
    ).result;
    expect(r.ok && r.calendar.offerings.map((o) => o.offeringId)).toEqual(["o2"]);
  });
  it("all candidates ineligible → empty calendar", async () => {
    const r = await run({ candidates: [offering("o1", { vehicle: vehicle("bad-1") })] }).result;
    expect(r.ok && r.calendar.offerings).toEqual([]);
  });
  it("public vehicle summary exposes only safe fields — never registrationNumber / registeredSeats / asset internals", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN")] }, { from: "2030-07-01", to: "2030-07-01" }).result;
    const v = r.ok ? r.calendar.offerings[0]!.vehicle : null;
    expect(Object.keys(v!).sort()).toEqual(["bookablePassengerCapacity", "color", "id", "make", "model", "modelYear", "vehicleType"].sort());
  });
});

describe("day + price resolution", () => {
  const win = { from: "2030-07-01", to: "2030-07-01" };
  it("OPEN + no override → base price, source BASE", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN")] }, win).result;
    const d = r.ok ? r.calendar.offerings[0]!.days[0]! : null;
    expect(d).toMatchObject({ dateKey: "2030-07-01", dayState: "OPEN", available: true, dailyPrice: { amount: "40.00", currency: "OMR" }, priceSource: "BASE" });
  });
  it("OPEN + valid override → override wins, source OVERRIDE", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN", "55.5")] }, win).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]).toMatchObject({ available: true, dailyPrice: { amount: "55.50", currency: "OMR" }, priceSource: "OVERRIDE" });
  });
  it("BLOCKED → unavailable, no price", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "BLOCKED")] }, win).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]).toMatchObject({ dayState: "BLOCKED", available: false, unavailableReason: "BLOCKED", dailyPrice: null, priceSource: null });
  });
  it("NONE (no row) → unavailable, no price", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [] }, win).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]).toMatchObject({ dayState: "NONE", available: false, unavailableReason: "NO_OPEN_DAY", dailyPrice: null });
  });
  it("past Oman day → unavailable (PAST), even if OPEN", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-06-14", "OPEN")] }, { from: "2030-06-14", to: "2030-06-14" }).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]).toMatchObject({ available: false, unavailableReason: "PAST", dailyPrice: null });
  });
  it("today (Oman) OPEN → available", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-06-15", "OPEN")] }, { from: "2030-06-15", to: "2030-06-15" }).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]!.available).toBe(true);
  });
  it("OPEN + malformed/zero/negative/over-precision override → NO_PRICE fail-closed (never silent base)", async () => {
    for (const bad of ["0", "-5", "40.123"]) {
      const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN", bad)] }, win).result;
      expect(r.ok && r.calendar.offerings[0]!.days[0]).toMatchObject({ dayState: "OPEN", available: false, unavailableReason: "NO_PRICE", dailyPrice: null });
    }
  });
  it("passenger capacity never multiplies the rate (daily amount is the flat per-day rate)", async () => {
    const r = await run({ candidates: [offering("o1", { vehicle: vehicle("good-1", 6) })], dayRows: [day("o1", "2030-07-01", "OPEN")] }, win).result;
    expect(r.ok && r.calendar.offerings[0]!.days[0]!.dailyPrice!.amount).toBe("40.00"); // NOT 40*6
    expect(r.ok && r.calendar.offerings[0]!.vehicle.bookablePassengerCapacity).toBe(6);
  });
});

describe("lowest-price aggregate", () => {
  it("uses only legitimate AVAILABLE days across offerings", async () => {
    const r = await run(
      {
        candidates: [offering("o1"), offering("o2")],
        dayRows: [day("o1", "2030-07-01", "OPEN", "50.00"), day("o1", "2030-07-02", "BLOCKED"), day("o2", "2030-07-01", "OPEN", "30.00"), day("o2", "2030-07-02", "OPEN", "999.00")],
      },
      { from: "2030-07-01", to: "2030-07-02" },
    ).result;
    expect(r.ok && r.calendar.lowestAvailableDailyRate).toEqual({ amount: "30.00", currency: "OMR" }); // min of available
  });
  it("no eligible/available day → lowest is null, never invented", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "BLOCKED")] }, { from: "2030-07-01", to: "2030-07-01" }).result;
    expect(r.ok && r.calendar.lowestAvailableDailyRate).toBeNull();
  });
  it("mixed offering currencies fail closed: top-level currency null + lowest null (never numeric compare)", async () => {
    const r = await run(
      {
        candidates: [offering("o1", { currency: "OMR" }), offering("o2", { currency: "USD" })],
        dayRows: [day("o1", "2030-07-01", "OPEN"), day("o2", "2030-07-01", "OPEN")],
      },
      { from: "2030-07-01", to: "2030-07-01" },
    ).result;
    expect(r.ok && r.calendar.currency).toBeNull();
    expect(r.ok && r.calendar.lowestAvailableDailyRate).toBeNull();
    expect(r.ok && r.calendar.offerings).toHaveLength(2); // per-offering calendars still returned
  });
});

describe("query bounds, security, reservation boundary, read failure", () => {
  const win = { from: "2030-07-01", to: "2030-07-03" };
  it("the day query carries the requested date bounds + offering-id set, and runs ONCE (no N+1, no start-times)", async () => {
    const { m, result } = run({ candidates: [offering("o1"), offering("o2")], dayRows: [] }, win);
    await result;
    expect(m.dayFindMany).toHaveBeenCalledTimes(1);
    const arg = m.dayFindMany.mock.calls[0]![0] as unknown as { where: Record<string, unknown>; select: Record<string, unknown> };
    expect(arg.where).toMatchObject({ rentalOfferingId: { in: ["o1", "o2"] } });
    expect((arg.where as { serviceDate: { gte: Date; lte: Date } }).serviceDate.gte).toEqual(dbDateFromOmanDateKey("2030-07-01"));
    expect((arg.where as { serviceDate: { gte: Date; lte: Date } }).serviceDate.lte).toEqual(dbDateFromOmanDateKey("2030-07-03"));
    expect(arg.select).not.toHaveProperty("startTimes");
  });
  it("availabilityBasis is CONFIGURED and no VEHICLE_CONFLICT reason is emitted (no reservation authority yet)", async () => {
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN")] }, win).result;
    expect(r.ok && r.calendar.availabilityBasis).toBe("CONFIGURED");
    const reasons = r.ok ? r.calendar.offerings.flatMap((o) => o.days.map((d) => d.unavailableReason)) : [];
    expect(reasons).not.toContain("VEHICLE_CONFLICT");
  });
  it("a DB read failure maps to READ_FAILED (safe)", async () => {
    expect(await run({ candidates: [offering("o1")], throwOn: "days" }, win).result).toEqual({ ok: false, reason: "READ_FAILED" });
    expect(await run({ throwOn: "service" }, win).result).toEqual({ ok: false, reason: "READ_FAILED" });
  });
  it("performs no writes: the fake db exposes only findFirst/findMany (any write would throw)", async () => {
    // makeDb has no create/update/delete delegates; a successful resolve proves read-only operation.
    const r = await run({ candidates: [offering("o1")], dayRows: [day("o1", "2030-07-01", "OPEN")] }, win).result;
    expect(r.ok).toBe(true);
  });
});

// C2c CORRECTION — deterministic keyset pagination + the two explicit bounds (inspected-candidate
// ceiling + eligible-offering response bound), replacing the earlier silent take:100 truncation.
describe("keyset pagination + candidate/eligible overflow bounds", () => {
  const pad = (n: number) => `off-${String(n).padStart(5, "0")}`;
  const cand = (n: number, valid: boolean) => (valid ? offering(pad(n), { vehicle: vehicle(`good-${pad(n)}`) }) : offering(pad(n), { vehicle: vehicle(`bad-${pad(n)}`) }));
  const win = { from: "2030-07-01", to: "2030-07-01" };
  const openDay = (offeringId: string) => day(offeringId, "2030-07-01", "OPEN");

  it("100 locally-invalid candidates + a valid candidate 101 → the valid offering is returned (no silent truncation)", async () => {
    const candidates = [...Array(100)].map((_, i) => cand(i + 1, false));
    candidates.push(cand(101, true));
    const r = await run({ candidates, dayRows: [openDay(pad(101))] }, win).result;
    expect(r.ok && r.calendar.offerings.map((o) => o.offeringId)).toEqual([pad(101)]);
    expect(r.ok && r.calendar.offerings[0]!.days[0]!.available).toBe(true);
  });

  it("valid candidate on page 2 (first full page all invalid)", async () => {
    const candidates = [...Array(RENTAL_CALENDAR_PAGE_SIZE)].map((_, i) => cand(i + 1, false));
    candidates.push(cand(RENTAL_CALENDAR_PAGE_SIZE + 3, true));
    const r = await run({ candidates, dayRows: [openDay(pad(RENTAL_CALENDAR_PAGE_SIZE + 3))] }, win).result;
    expect(r.ok && r.calendar.offerings.map((o) => o.offeringId)).toEqual([pad(RENTAL_CALENDAR_PAGE_SIZE + 3)]);
  });

  it("cursor advances by the last unique id; no duplicate/skip; DB order cannot change the result; partial last page → no overflow probe", async () => {
    const candidates = [...Array(120)].map((_, i) => cand(i + 1, false)); // 3 pages: 50,50,20 → all invalid → empty
    // Provide the input SHUFFLED to prove ordering is enforced by the query, not the input order.
    const shuffled = [...candidates].reverse();
    const { m, result } = run({ candidates: shuffled }, win);
    const r = await result;
    expect(r.ok && r.calendar.offerings).toEqual([]);
    const gts = m.offeringFindMany.mock.calls.map((c) => (c[0] as { where: { id?: { gt?: string } } }).where.id?.gt);
    expect(gts).toEqual([undefined, pad(50), pad(100)]); // page cursors = previous page's last id, strictly advancing
    expect(m.offeringFindFirst).not.toHaveBeenCalled(); // partial final page (20 < 50) ⇒ exhausted, no probe
  });

  it("EXACTLY the inspected-candidate ceiling with no more rows → normal empty calendar (probe returns none)", async () => {
    const candidates = [...Array(MAX_RENTAL_CALENDAR_CANDIDATES)].map((_, i) => cand(i + 1, false));
    const { m, result } = run({ candidates }, win);
    expect(await result).toMatchObject({ ok: true });
    expect(m.offeringFindFirst).toHaveBeenCalledTimes(1); // probed for a row beyond the ceiling → none
  });

  it("candidate 1001 (one beyond the ceiling) → CANDIDATE_LIMIT_EXCEEDED (never a partial/misleading calendar)", async () => {
    const candidates = [...Array(MAX_RENTAL_CALENDAR_CANDIDATES + 1)].map((_, i) => cand(i + 1, false));
    const r = await run({ candidates }, win).result;
    expect(r).toEqual({ ok: false, reason: "CANDIDATE_LIMIT_EXCEEDED" });
  });

  it("EXACTLY the eligible-response limit with no further eligible offering → succeeds with that many offerings", async () => {
    const candidates = [...Array(MAX_RENTAL_CALENDAR_OFFERINGS)].map((_, i) => cand(i + 1, true));
    const r = await run({ candidates }, win).result;
    expect(r.ok && r.calendar.offerings).toHaveLength(MAX_RENTAL_CALENDAR_OFFERINGS);
  });

  it("one eligible offering beyond the response limit → ELIGIBLE_OFFERING_LIMIT_EXCEEDED (101st never silently discarded)", async () => {
    const candidates = [...Array(MAX_RENTAL_CALENDAR_OFFERINGS + 1)].map((_, i) => cand(i + 1, true));
    const r = await run({ candidates }, win).result;
    expect(r).toEqual({ ok: false, reason: "ELIGIBLE_OFFERING_LIMIT_EXCEEDED" });
  });

  it("SERVICE-WIDE lowest price reflects a lower rate found on a later page (not just page 1)", async () => {
    const candidates = [...Array(RENTAL_CALENDAR_PAGE_SIZE)].map((_, i) => cand(i + 1, true)); // page 1: all base 40
    candidates.push(cand(RENTAL_CALENDAR_PAGE_SIZE + 1, true)); // page 2
    const dayRows = candidates.map((c) => openDay(c.id));
    dayRows.push(day(pad(RENTAL_CALENDAR_PAGE_SIZE + 1), "2030-07-01", "OPEN", "12.00")); // cheaper override on page 2
    const r = await run({ candidates, dayRows }, win).result;
    expect(r.ok && r.calendar.lowestAvailableDailyRate).toEqual({ amount: "12.00", currency: "OMR" });
  });

  it("runs at most one batched day query per page, and NONE for a page with zero locally-ready candidates", async () => {
    // page 1: 50 invalid (no day query). page 2: one valid (one day query).
    const candidates = [...Array(RENTAL_CALENDAR_PAGE_SIZE)].map((_, i) => cand(i + 1, false));
    candidates.push(cand(RENTAL_CALENDAR_PAGE_SIZE + 1, true));
    const { m, result } = run({ candidates, dayRows: [openDay(pad(RENTAL_CALENDAR_PAGE_SIZE + 1))] }, win);
    await result;
    expect(m.dayFindMany).toHaveBeenCalledTimes(1); // only the page with a ready candidate
  });
});
