import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Isolate acquire's own algorithm: the reused vertical/vehicle authorities are mocked (their own
// tests cover them), so these exercise selection validation, day/price resolution, capacity, price
// drift, atomic multi-date insert, the DB-conflict → VEHICLE_DATE_CONFLICT mapping, idempotency
// replay/mismatch, and the in-tx success audit. The fake DB models the ACTIVE-partial-unique arbiter
// (a 2nd active row for the same (vehicle, day) throws P2002) and transactional all-or-nothing.
const vertical = vi.fn();
const vehicleReady = vi.fn();
vi.mock("../rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rental-offering-authorization")>();
  return {
    ...actual,
    assertRentalVerticalCompliant: (...a: unknown[]) => vertical(...a),
    assertRentalVehicleReady: (...a: unknown[]) => vehicleReady(...a),
  };
});

const { acquireDailyRentalHold } = await import("./acquire-daily-rental-hold");
const { computeRentalHoldRequestFingerprint, computeRentalHoldQuoteFingerprint, RENTAL_HOLD_TTL_MINUTES } = await import("./reservation-types");

const NOW = new Date("2030-07-01T08:00:00.000Z");
const CUST = "cust-1";
const OFFERING = "off-1";
const VEHICLE = "veh-1";
const SERVICE = "svc-1";
const PROVIDER = "prov-1";
const dbDate = (k: string) => new Date(`${k}T00:00:00.000Z`);
const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

type Row = {
  id: string; holdGroupId: string; holdToken: string; customerId: string; serviceId: string;
  rentalOfferingId: string; vehicleId: string; serviceDate: Date; status: string;
  dailyAmount: Prisma.Decimal; currency: string; priceSource: string;
  expiresAt: Date | null; releasedAt: Date | null; bookingId: string | null;
  idempotencyKey: string | null; requestFingerprint: string | null;
};

// Fake offering config the test can tweak.
type DayCfg = { state: "OPEN" | "BLOCKED"; override?: string | null };
function makeDb(opts: {
  offering?: null | { currency?: string; base?: string; capacityOverride?: number | null; bookableCapacity?: number | null };
  days?: Record<string, DayCfg>;
  seedRows?: Row[];
  missingCustomer?: boolean;
}) {
  const reservations: Row[] = opts.seedRows ? [...opts.seedRows] : [];
  const audits: { action: string; entityId: string; newValue: unknown; actorId: string | null }[] = [];
  const offering = opts.offering === null ? null : {
    id: OFFERING, serviceId: SERVICE, currency: opts.offering?.currency ?? "OMR",
    baseDailyAmount: new Prisma.Decimal(opts.offering?.base ?? "40.00"),
    offeringCapacityOverride: opts.offering?.capacityOverride ?? null,
    service: { providerId: PROVIDER },
    vehicle: { assetId: VEHICLE, bookablePassengerCapacity: opts.offering?.bookableCapacity ?? 7, asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] } },
  };
  const activeStatuses = new Set(["HELD", "CONFIRMED"]);

  const matchRow = (r: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR") { if (!(v as Record<string, unknown>[]).some((c) => matchRow(r, c))) return false; continue; }
      if (k === "serviceDate") {
        const f = v as { in?: Date[]; gte?: Date; lte?: Date };
        if (f.in && !f.in.some((d) => d.getTime() === r.serviceDate.getTime())) return false;
        if (f.gte && r.serviceDate < f.gte) return false;
        if (f.lte && r.serviceDate > f.lte) return false;
        continue;
      }
      if (k === "expiresAt") { const f = v as { lte?: Date; gt?: Date }; if (f.lte && !(r.expiresAt && r.expiresAt <= f.lte)) return false; if (f.gt && !(r.expiresAt && r.expiresAt > f.gt)) return false; continue; }
      if (k === "id") { const f = v as { in?: string[] }; if (f.in && !f.in.includes(r.id)) return false; continue; }
      if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  };

  const model = {
    findMany: async ({ where }: { where: Record<string, unknown>; select?: unknown }) => reservations.filter((r) => matchRow(r, where)).map((r) => ({ ...r })),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => reservations.find((r) => matchRow(r, where)) ?? null,
    count: async ({ where }: { where: Record<string, unknown> }) => reservations.filter((r) => matchRow(r, where)).length,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const r of reservations) if (matchRow(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      // Active-partial-unique arbiter: reject the WHOLE batch if ANY (vehicle, day) is already active.
      for (const d of data) {
        const clash = reservations.some((r) => r.vehicleId === d.vehicleId && r.serviceDate.getTime() === (d.serviceDate as Date).getTime() && activeStatuses.has(r.status));
        if (clash) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["vehicleId", "serviceDate"] } });
      }
      let n = 0;
      for (const d of data) { reservations.push({ ...(d as unknown as Row), id: `r${reservations.length + 1}`, releasedAt: (d as unknown as Row).releasedAt ?? null, bookingId: (d as unknown as Row).bookingId ?? null }); n++; }
      return { count: n };
    },
  };

  const db = {
    customer: { findUnique: async ({ where }: { where: { id: string } }) => (opts.missingCustomer || where.id !== CUST ? null : { id: CUST }) },
    rentalOffering: { findFirst: async () => (offering ? { ...offering } : null) },
    rentalOfferingDay: {
      findMany: async ({ where }: { where: { serviceDate: { in: Date[] } } }) => {
        const rows: { serviceDate: Date; state: string; dailyAmountOverride: Prisma.Decimal | null }[] = [];
        for (const d of where.serviceDate.in) {
          const cfg = opts.days?.[keyOf(d)];
          if (cfg) rows.push({ serviceDate: d, state: cfg.state, dailyAmountOverride: cfg.override != null ? new Prisma.Decimal(cfg.override) : null });
        }
        return rows;
      },
    },
    rentalVehicleDayReservation: model,
    auditLog: { create: async ({ data }: { data: { action: string; entityId: string; newValue: unknown; actorId: string | null } }) => { audits.push(data); return data; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = reservations.map((r) => ({ ...r }));
      const auditSnapshot = audits.length;
      try { return await fn(db); }
      catch (e) { reservations.length = 0; reservations.push(...snapshot); audits.length = auditSnapshot; throw e; }
    },
  };
  return { db, reservations, audits };
}

const RANGE = { offering: {}, days: { "2030-07-10": { state: "OPEN" as const }, "2030-07-11": { state: "OPEN" as const }, "2030-07-12": { state: "OPEN" as const } } };
const run = (db: unknown, params: Partial<Parameters<typeof acquireDailyRentalHold>[1]>) =>
  acquireDailyRentalHold(db as never, { customerId: CUST, offeringId: OFFERING, dateKeys: ["2030-07-10"], passengerCount: 2, now: NOW, ...params });

beforeEach(() => { vertical.mockResolvedValue(null); vehicleReady.mockReturnValue(null); });

describe("acquireDailyRentalHold — selection + capacity validation", () => {
  it("rejects an empty selection", async () => { const { db } = makeDb(RANGE); expect(await run(db, { dateKeys: [] })).toEqual({ ok: false, reason: "INVALID_SELECTION" }); });
  it("rejects duplicate dates (never silently deduped)", async () => { const { db } = makeDb(RANGE); expect(await run(db, { dateKeys: ["2030-07-10", "2030-07-10"] })).toEqual({ ok: false, reason: "INVALID_SELECTION" }); });
  it("rejects a malformed date", async () => { const { db } = makeDb(RANGE); expect(await run(db, { dateKeys: ["2030-13-40"] })).toEqual({ ok: false, reason: "INVALID_SELECTION" }); });
  it("rejects a past Oman date", async () => { const { db } = makeDb(RANGE); expect(await run(db, { dateKeys: ["2030-06-30"] })).toEqual({ ok: false, reason: "INVALID_SELECTION" }); });
  it("rejects a selection larger than the max bound", async () => {
    const { db } = makeDb(RANGE);
    const keys = Array.from({ length: 63 }, (_, i) => keyOf(new Date(Date.UTC(2030, 6, 10 + i))));
    expect(await run(db, { dateKeys: keys })).toEqual({ ok: false, reason: "INVALID_SELECTION" });
  });
  it("rejects a non-positive / non-integer passenger count", async () => {
    const { db } = makeDb(RANGE);
    expect((await run(db, { passengerCount: 0 })).ok).toBe(false);
    expect(await run(db, { passengerCount: -1 })).toEqual({ ok: false, reason: "INVALID_PASSENGER_COUNT" });
    expect(await run(db, { passengerCount: 2.5 })).toEqual({ ok: false, reason: "INVALID_PASSENGER_COUNT" });
  });
  it("rejects passenger count above the effective bookable capacity (zero rows written)", async () => {
    const { db, reservations } = makeDb({ ...RANGE, offering: { bookableCapacity: 4 } });
    expect(await run(db, { passengerCount: 5 })).toEqual({ ok: false, reason: "CAPACITY_EXCEEDED" });
    expect(reservations).toHaveLength(0);
  });
  it("honors a stricter offering capacity override", async () => {
    const { db } = makeDb({ ...RANGE, offering: { bookableCapacity: 7, capacityOverride: 3 } });
    const over = await run(db, { passengerCount: 4 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("CAPACITY_EXCEEDED");
    expect((await run(db, { passengerCount: 3 })).ok).toBe(true);
  });
});

describe("acquireDailyRentalHold — eligibility fail-closed (uniform NOT_BOOKABLE)", () => {
  it("returns NOT_BOOKABLE when the offering is not public/eligible", async () => { const { db } = makeDb({ offering: null }); expect(await run(db, {})).toEqual({ ok: false, reason: "NOT_BOOKABLE" }); });
  it("returns NOT_BOOKABLE when the vertical is non-compliant (cause hidden)", async () => { const { db } = makeDb(RANGE); vertical.mockResolvedValue("VERTICAL_NOT_COMPLIANT"); expect(await run(db, {})).toEqual({ ok: false, reason: "NOT_BOOKABLE" }); });
  it("returns NOT_BOOKABLE when the vehicle is not ready", async () => { const { db } = makeDb(RANGE); vehicleReady.mockReturnValue("VEHICLE_NOT_SELECTABLE"); expect(await run(db, {})).toEqual({ ok: false, reason: "NOT_BOOKABLE" }); });
  it("returns NOT_BOOKABLE when the owner no longer exists", async () => { const { db } = makeDb({ ...RANGE, missingCustomer: true }); expect(await run(db, {})).toEqual({ ok: false, reason: "NOT_BOOKABLE" }); });
});

describe("acquireDailyRentalHold — day + price resolution", () => {
  it("rejects when a selected day is BLOCKED / NONE (missing)", async () => {
    const { db } = makeDb({ offering: {}, days: { "2030-07-10": { state: "BLOCKED" } } });
    expect(await run(db, { dateKeys: ["2030-07-10"] })).toEqual({ ok: false, reason: "DAY_NOT_AVAILABLE" });
    const missing = makeDb({ offering: {}, days: {} });
    expect(await run(missing.db, { dateKeys: ["2030-07-10"] })).toEqual({ ok: false, reason: "DAY_NOT_AVAILABLE" });
  });
  it("fails closed on a malformed override", async () => {
    const { db } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN", override: "-5" } } });
    expect(await run(db, { dateKeys: ["2030-07-10"] })).toEqual({ ok: false, reason: "DAY_NOT_AVAILABLE" });
  });
  it("uses the base rate, and an override wins when present (per-day priceSource)", async () => {
    const { db } = makeDb({ offering: { base: "40.00" }, days: { "2030-07-10": { state: "OPEN" }, "2030-07-11": { state: "OPEN", override: "55.00" } } });
    const res = await run(db, { dateKeys: ["2030-07-10", "2030-07-11"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hold.quote.days).toEqual([
      { dateKey: "2030-07-10", amount: "40.00", currency: "OMR", priceSource: "BASE" },
      { dateKey: "2030-07-11", amount: "55.00", currency: "OMR", priceSource: "OVERRIDE" },
    ]);
    expect(res.hold.quote.total).toBe("95.00");
    expect(res.hold.quote.lowestDailyRate).toBe("40.00");
    expect(res.hold.quote.chargeableDays).toBe(2);
  });
});

describe("acquireDailyRentalHold — atomic multi-date + pricing invariants", () => {
  it("holds a single day and writes exactly one HELD row with a TTL expiry", async () => {
    const { db, reservations } = makeDb(RANGE);
    const res = await run(db, { dateKeys: ["2030-07-10"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe("HELD");
    expect(reservations[0]!.expiresAt!.getTime()).toBe(NOW.getTime() + RENTAL_HOLD_TTL_MINUTES * 60_000);
    expect(res.hold.replayed).toBe(false);
  });
  it("holds non-consecutive dates and reserves ONLY those exact dates", async () => {
    const { db, reservations } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" }, "2030-07-12": { state: "OPEN" } } });
    const res = await run(db, { dateKeys: ["2030-07-12", "2030-07-10"] });
    expect(res.ok).toBe(true);
    expect(reservations.map((r) => keyOf(r.serviceDate)).sort()).toEqual(["2030-07-10", "2030-07-12"]);
  });
  it("passenger count never changes the vehicle total", async () => {
    const a = makeDb(RANGE); const b = makeDb(RANGE);
    const ra = await run(a.db, { dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 2 });
    const rb = await run(b.db, { dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 6 });
    expect(ra.ok && rb.ok && ra.hold.quote.total === rb.hold.quote.total).toBe(true);
  });
  it("maps a DB uniqueness conflict to VEHICLE_DATE_CONFLICT with no partial hold", async () => {
    // Pre-seed an active HELD on the LAST date of a 2-date group; the group insert must fully roll back.
    const seed: Row = { id: "seed", holdGroupId: "g0", holdToken: "t0", customerId: "other", serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId: VEHICLE, serviceDate: dbDate("2030-07-11"), status: "HELD", dailyAmount: new Prisma.Decimal("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: new Date(NOW.getTime() + 600000), releasedAt: null, bookingId: null, idempotencyKey: null, requestFingerprint: null };
    const { db, reservations } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" }, "2030-07-11": { state: "OPEN" } }, seedRows: [seed] });
    const res = await run(db, { dateKeys: ["2030-07-10", "2030-07-11"] });
    expect(res).toEqual({ ok: false, reason: "VEHICLE_DATE_CONFLICT" });
    expect(reservations.filter((r) => r.holdGroupId !== "g0")).toHaveLength(0); // no partial rows for 07-10
  });
  it("an EXPIRED / RELEASED row on the same day does NOT block re-acquisition", async () => {
    const seed: Row = { id: "seed", holdGroupId: "g0", holdToken: "t0", customerId: "other", serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId: VEHICLE, serviceDate: dbDate("2030-07-10"), status: "RELEASED", dailyAmount: new Prisma.Decimal("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: null, releasedAt: NOW, bookingId: null, idempotencyKey: null, requestFingerprint: null };
    const { db } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" } }, seedRows: [seed] });
    expect((await run(db, { dateKeys: ["2030-07-10"] })).ok).toBe(true);
  });
  it("expires a lapsed HELD for the target day, then re-acquires it", async () => {
    const seed: Row = { id: "seed", holdGroupId: "g0", holdToken: "t0", customerId: "other", serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId: VEHICLE, serviceDate: dbDate("2030-07-10"), status: "HELD", dailyAmount: new Prisma.Decimal("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: new Date(NOW.getTime() - 1000), releasedAt: null, bookingId: null, idempotencyKey: null, requestFingerprint: null };
    const { db, reservations } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" } }, seedRows: [seed] });
    expect((await run(db, { dateKeys: ["2030-07-10"] })).ok).toBe(true);
    expect(reservations.find((r) => r.id === "seed")!.status).toBe("EXPIRED");
    expect(reservations.filter((r) => r.status === "HELD")).toHaveLength(1);
  });
});

describe("acquireDailyRentalHold — price drift", () => {
  it("returns PRICE_CHANGED (with the fresh quote, no hold) when the expected TOTAL differs", async () => {
    const { db, reservations } = makeDb(RANGE);
    const res = await run(db, { dateKeys: ["2030-07-10"], expectedQuote: { total: "99.00", currency: "OMR" } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("PRICE_CHANGED");
    expect(res.quote?.total).toBe("40.00");
    expect(reservations).toHaveLength(0);
  });
  it("returns PRICE_CHANGED when the expected FINGERPRINT differs", async () => {
    const { db } = makeDb(RANGE);
    const res = await run(db, { dateKeys: ["2030-07-10"], expectedQuote: { fingerprint: "stale" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("PRICE_CHANGED");
  });
  it("acquires when the expected fingerprint MATCHES the authoritative quote", async () => {
    const fp = computeRentalHoldQuoteFingerprint({ offeringId: OFFERING, currency: "OMR", total: "40.00", days: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", priceSource: "BASE" }] });
    const { db } = makeDb(RANGE);
    expect((await run(db, { dateKeys: ["2030-07-10"], expectedQuote: { fingerprint: fp } })).ok).toBe(true);
  });
});

describe("acquireDailyRentalHold — idempotency", () => {
  it("replays the same hold for the same key + same request (no new rows)", async () => {
    const { db, reservations } = makeDb(RANGE);
    const first = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(first.ok).toBe(true);
    const before = reservations.length;
    const second = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.hold.replayed).toBe(true);
    expect(second.hold.holdGroupId).toBe(first.hold.holdGroupId);
    expect(reservations.length).toBe(before); // no duplicate rows
  });
  it("fails with IDEMPOTENCY_MISMATCH for the same key + materially different request", async () => {
    const { db } = makeDb(RANGE);
    await run(db, { dateKeys: ["2030-07-10"], passengerCount: 2, idempotencyKey: "k1" });
    const res = await run(db, { dateKeys: ["2030-07-10"], passengerCount: 5, idempotencyKey: "k1" });
    expect(res).toEqual({ ok: false, reason: "IDEMPOTENCY_MISMATCH" });
  });
  it("converges on the winning group when a concurrent identical key hits the DB conflict", async () => {
    // Simulate the loser of a concurrent identical request: the winner's group already exists under
    // the same key + fingerprint, and the (vehicle, day) is active → the loser's insert would P2002 →
    // it replays the winner instead of surfacing a conflict.
    const fp = computeRentalHoldRequestFingerprint({ offeringId: OFFERING, dateKeys: ["2030-07-10"], passengerCount: 2 });
    const winner: Row = { id: "w", holdGroupId: "gw", holdToken: "tw", customerId: CUST, serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId: VEHICLE, serviceDate: dbDate("2030-07-10"), status: "HELD", dailyAmount: new Prisma.Decimal("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: new Date(NOW.getTime() + 600000), releasedAt: null, bookingId: null, idempotencyKey: "k1", requestFingerprint: fp };
    const { db } = makeDb({ ...RANGE, seedRows: [winner] });
    const res = await run(db, { dateKeys: ["2030-07-10"], passengerCount: 2, idempotencyKey: "k1" });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.hold.replayed).toBe(true); expect(res.hold.holdGroupId).toBe("gw"); }
  });
});

describe("acquireDailyRentalHold — audit", () => {
  it("writes ONE success audit with structured, non-sensitive fields (owner id only)", async () => {
    const { db, audits } = makeDb(RANGE);
    await run(db, { dateKeys: ["2030-07-10", "2030-07-11"] });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("rental.daily_hold_acquired");
    expect(audits[0]!.actorId).toBe(CUST);
    expect(JSON.stringify(audits[0]!.newValue)).not.toMatch(/holdToken|registrationNumber|passenger/i);
  });
  it("writes NO audit on a failed acquisition (capacity)", async () => {
    const { db, audits } = makeDb({ ...RANGE, offering: { bookableCapacity: 2 } });
    await run(db, { passengerCount: 5 });
    expect(audits).toHaveLength(0);
  });
});
