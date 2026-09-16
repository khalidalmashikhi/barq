import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Isolate acquire's own algorithm: the reused vertical/vehicle authorities are mocked. The fake DB
// models BOTH arbiters — the hold-group header's UNIQUE(customerId, idempotencyKey) and the child
// rows' active (vehicleId, serviceDate) partial unique — plus transactional all-or-nothing rollback.
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
const dec = (s: string) => new Prisma.Decimal(s);

type GroupRow = {
  id: string; holdToken: string; customerId: string; serviceId: string; rentalOfferingId: string; vehicleId: string;
  passengerCount: number; idempotencyKey: string | null; requestFingerprint: string | null;
  quoteFingerprint: string; totalAmount: Prisma.Decimal; currency: string; bookingId: string | null;
};
type ChildRow = {
  id: string; holdGroupId: string; vehicleId: string; serviceDate: Date; status: string;
  dailyAmount: Prisma.Decimal; currency: string; priceSource: string; expiresAt: Date | null; releasedAt: Date | null;
};

const P2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["x"] } });

type DayCfg = { state: "OPEN" | "BLOCKED"; override?: string | null };
function makeDb(opts: {
  offering?: null | { currency?: string; base?: string; capacityOverride?: number | null; bookableCapacity?: number | null };
  days?: Record<string, DayCfg>;
  seedGroups?: GroupRow[];
  seedChildren?: ChildRow[];
  missingCustomer?: boolean;
}) {
  const groups: GroupRow[] = opts.seedGroups ? [...opts.seedGroups] : [];
  const children: ChildRow[] = opts.seedChildren ? [...opts.seedChildren] : [];
  const audits: { action: string; entityType: string; entityId: string; newValue: unknown; actorId: string | null }[] = [];
  const offering = opts.offering === null ? null : {
    id: OFFERING, serviceId: SERVICE, currency: opts.offering?.currency ?? "OMR",
    baseDailyAmount: dec(opts.offering?.base ?? "40.00"),
    offeringCapacityOverride: opts.offering?.capacityOverride ?? null,
    service: { providerId: PROVIDER },
    vehicle: { assetId: VEHICLE, bookablePassengerCapacity: opts.offering?.bookableCapacity ?? 7, asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] } },
  };
  const active = new Set(["HELD", "CONFIRMED"]);

  const childMatch = (r: ChildRow, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === "serviceDate") { const f = v as { in?: Date[] }; if (f.in && !f.in.some((d) => d.getTime() === r.serviceDate.getTime())) return false; continue; }
      if (k === "expiresAt") { const f = v as { lte?: Date }; if (f.lte && !(r.expiresAt && r.expiresAt <= f.lte)) return false; continue; }
      if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  };

  const childModel = {
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) {
        const clash = children.some((r) => r.vehicleId === d.vehicleId && r.serviceDate.getTime() === (d.serviceDate as Date).getTime() && active.has(r.status));
        if (clash) throw P2002();
      }
      let n = 0;
      for (const d of data) { children.push({ ...(d as unknown as ChildRow), id: `c${children.length + 1}`, releasedAt: (d as unknown as ChildRow).releasedAt ?? null }); n++; }
      return { count: n };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const r of children) if (childMatch(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => children.filter((r) => childMatch(r, where)).map((r) => ({ ...r })),
  };

  const groupModel = {
    findUnique: async ({ where }: { where: { customerId_idempotencyKey: { customerId: string; idempotencyKey: string } } }) => {
      const { customerId, idempotencyKey } = where.customerId_idempotencyKey;
      const g = groups.find((x) => x.customerId === customerId && x.idempotencyKey === idempotencyKey);
      if (!g) return null;
      return { ...g, reservations: children.filter((c) => c.holdGroupId === g.id).map((c) => ({ serviceDate: c.serviceDate, dailyAmount: c.dailyAmount, currency: c.currency, priceSource: c.priceSource, status: c.status, expiresAt: c.expiresAt })) };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.idempotencyKey !== null && data.idempotencyKey !== undefined && groups.some((g) => g.customerId === data.customerId && g.idempotencyKey === data.idempotencyKey)) throw P2002();
      const row = { ...(data as unknown as GroupRow), id: `g${groups.length + 1}`, bookingId: (data as unknown as GroupRow).bookingId ?? null };
      groups.push(row);
      return { id: row.id };
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
          if (cfg) rows.push({ serviceDate: d, state: cfg.state, dailyAmountOverride: cfg.override != null ? dec(cfg.override) : null });
        }
        return rows;
      },
    },
    rentalVehicleDayHoldGroup: groupModel,
    rentalVehicleDayReservation: childModel,
    auditLog: { create: async ({ data }: { data: { action: string; entityType: string; entityId: string; newValue: unknown; actorId: string | null } }) => { audits.push(data); return data; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const gSnap = groups.map((g) => ({ ...g }));
      const cSnap = children.map((c) => ({ ...c }));
      const aLen = audits.length;
      try { return await fn(db); }
      catch (e) { groups.length = 0; groups.push(...gSnap); children.length = 0; children.push(...cSnap); audits.length = aLen; throw e; }
    },
  };
  return { db, groups, children, audits };
}

const RANGE = { offering: {}, days: { "2030-07-10": { state: "OPEN" as const }, "2030-07-11": { state: "OPEN" as const }, "2030-07-12": { state: "OPEN" as const } } };
const run = (db: unknown, params: Partial<Parameters<typeof acquireDailyRentalHold>[1]>) =>
  acquireDailyRentalHold(db as never, { customerId: CUST, offeringId: OFFERING, dateKeys: ["2030-07-10"], passengerCount: 2, now: NOW, ...params });

// A seed group + one active HELD child on a given (vehicle, date), for conflict/lifecycle tests.
const seedActive = (holdGroupId: string, vehicleId: string, dateKey: string, over: Partial<ChildRow> = {}, customerId = "other"): { group: GroupRow; child: ChildRow } => ({
  group: { id: holdGroupId, holdToken: "t", customerId, serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId, passengerCount: 2, idempotencyKey: null, requestFingerprint: null, quoteFingerprint: "q", totalAmount: dec("40.00"), currency: "OMR", bookingId: null },
  child: { id: `seed-${dateKey}`, holdGroupId, vehicleId, serviceDate: dbDate(dateKey), status: "HELD", dailyAmount: dec("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: new Date(NOW.getTime() + 600000), releasedAt: null, ...over },
});

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
    const { db, children, groups } = makeDb({ ...RANGE, offering: { bookableCapacity: 4 } });
    expect(await run(db, { passengerCount: 5 })).toEqual({ ok: false, reason: "CAPACITY_EXCEEDED" });
    expect(children).toHaveLength(0);
    expect(groups).toHaveLength(0);
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
  it("holds a single day: one group header + exactly one HELD child with a TTL expiry", async () => {
    const { db, children, groups } = makeDb(RANGE);
    const res = await run(db, { dateKeys: ["2030-07-10"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(groups).toHaveLength(1);
    expect(children).toHaveLength(1);
    expect(children[0]!.status).toBe("HELD");
    expect(children[0]!.expiresAt!.getTime()).toBe(NOW.getTime() + RENTAL_HOLD_TTL_MINUTES * 60_000);
    expect(res.hold.replayed).toBe(false);
    expect(res.hold.holdGroupId).toBe(groups[0]!.id);
  });
  it("holds non-consecutive dates and reserves ONLY those exact dates", async () => {
    const { db, children } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" }, "2030-07-12": { state: "OPEN" } } });
    const res = await run(db, { dateKeys: ["2030-07-12", "2030-07-10"] });
    expect(res.ok).toBe(true);
    expect(children.map((r) => keyOf(r.serviceDate)).sort()).toEqual(["2030-07-10", "2030-07-12"]);
  });
  it("passenger count never changes the vehicle total", async () => {
    const a = makeDb(RANGE); const b = makeDb(RANGE);
    const ra = await run(a.db, { dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 2 });
    const rb = await run(b.db, { dateKeys: ["2030-07-10", "2030-07-11"], passengerCount: 6 });
    expect(ra.ok && rb.ok && ra.hold.quote.total === rb.hold.quote.total).toBe(true);
  });
  it("maps a physical (vehicle,date) conflict to VEHICLE_DATE_CONFLICT with no partial hold or orphan group", async () => {
    // Pre-seed an active HELD on the LAST date of a 2-date group; the group insert + children must fully roll back.
    const seed = seedActive("g0", VEHICLE, "2030-07-11");
    const { db, children, groups } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" }, "2030-07-11": { state: "OPEN" } }, seedGroups: [seed.group], seedChildren: [seed.child] });
    const res = await run(db, { dateKeys: ["2030-07-10", "2030-07-11"] });
    expect(res).toEqual({ ok: false, reason: "VEHICLE_DATE_CONFLICT" });
    expect(children.filter((r) => r.holdGroupId !== "g0")).toHaveLength(0); // no partial child for 07-10
    expect(groups.filter((g) => g.id !== "g0")).toHaveLength(0); // no orphan header
  });
  it("an EXPIRED / RELEASED row on the same day does NOT block re-acquisition", async () => {
    const seed = seedActive("g0", VEHICLE, "2030-07-10", { status: "RELEASED", expiresAt: null, releasedAt: NOW });
    const { db } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" } }, seedGroups: [seed.group], seedChildren: [seed.child] });
    expect((await run(db, { dateKeys: ["2030-07-10"] })).ok).toBe(true);
  });
  it("expires a lapsed HELD for the target day, then re-acquires it", async () => {
    const seed = seedActive("g0", VEHICLE, "2030-07-10", { expiresAt: new Date(NOW.getTime() - 1000) });
    const { db, children } = makeDb({ offering: {}, days: { "2030-07-10": { state: "OPEN" } }, seedGroups: [seed.group], seedChildren: [seed.child] });
    expect((await run(db, { dateKeys: ["2030-07-10"] })).ok).toBe(true);
    expect(children.find((r) => r.id === "seed-2030-07-10")!.status).toBe("EXPIRED");
    expect(children.filter((r) => r.status === "HELD")).toHaveLength(1);
  });
});

describe("acquireDailyRentalHold — price drift", () => {
  it("returns PRICE_CHANGED (with the fresh quote, no hold) when the expected TOTAL differs", async () => {
    const { db, children, groups } = makeDb(RANGE);
    const res = await run(db, { dateKeys: ["2030-07-10"], expectedQuote: { total: "99.00", currency: "OMR" } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("PRICE_CHANGED");
    expect(res.quote?.total).toBe("40.00");
    expect(children).toHaveLength(0);
    expect(groups).toHaveLength(0);
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

describe("acquireDailyRentalHold — idempotency (DB group arbiter)", () => {
  it("replays the same hold for the same key + same request (no new group or rows)", async () => {
    const { db, children, groups } = makeDb(RANGE);
    const first = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(first.ok).toBe(true);
    const childBefore = children.length;
    const groupBefore = groups.length;
    const second = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.hold.replayed).toBe(true);
    expect(second.hold.holdGroupId).toBe(first.hold.holdGroupId);
    expect(children.length).toBe(childBefore); // no duplicate rows
    expect(groups.length).toBe(groupBefore); // no duplicate group
  });
  it("fails with IDEMPOTENCY_MISMATCH for the same key + materially different request", async () => {
    const { db } = makeDb(RANGE);
    await run(db, { dateKeys: ["2030-07-10"], passengerCount: 2, idempotencyKey: "k1" });
    const res = await run(db, { dateKeys: ["2030-07-10"], passengerCount: 5, idempotencyKey: "k1" });
    expect(res).toEqual({ ok: false, reason: "IDEMPOTENCY_MISMATCH" });
  });
  it("replays the winning group when an identical keyed group already exists (convergence)", async () => {
    const fp = computeRentalHoldRequestFingerprint({ offeringId: OFFERING, dateKeys: ["2030-07-10"], passengerCount: 2 });
    const winnerGroup: GroupRow = { id: "gw", holdToken: "tw", customerId: CUST, serviceId: SERVICE, rentalOfferingId: OFFERING, vehicleId: VEHICLE, passengerCount: 2, idempotencyKey: "k1", requestFingerprint: fp, quoteFingerprint: "q", totalAmount: dec("40.00"), currency: "OMR", bookingId: null };
    const winnerChild: ChildRow = { id: "cw", holdGroupId: "gw", vehicleId: VEHICLE, serviceDate: dbDate("2030-07-10"), status: "HELD", dailyAmount: dec("40.00"), currency: "OMR", priceSource: "BASE", expiresAt: new Date(NOW.getTime() + 600000), releasedAt: null };
    const { db } = makeDb({ ...RANGE, seedGroups: [winnerGroup], seedChildren: [winnerChild] });
    const res = await run(db, { dateKeys: ["2030-07-10"], passengerCount: 2, idempotencyKey: "k1" });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.hold.replayed).toBe(true); expect(res.hold.holdGroupId).toBe("gw"); }
  });
  it("stable historical replay: replaying a key whose hold was RELEASED returns the original group, no new hold", async () => {
    const { db, groups, children } = makeDb(RANGE);
    const first = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(first.ok).toBe(true);
    // Release it (simulate lifecycle): flip the child to RELEASED.
    children.forEach((c) => { if (c.holdGroupId === (first.ok ? first.hold.holdGroupId : "")) { c.status = "RELEASED"; c.releasedAt = NOW; c.expiresAt = null; } });
    const groupBefore = groups.length;
    const replay = await run(db, { dateKeys: ["2030-07-10"], idempotencyKey: "k1" });
    expect(replay.ok).toBe(true);
    if (!replay.ok || !first.ok) return;
    expect(replay.hold.replayed).toBe(true);
    expect(replay.hold.holdGroupId).toBe(first.hold.holdGroupId);
    expect(replay.hold.status).toBe("RELEASED"); // reflects reality; NOT a fresh HELD
    expect(groups.length).toBe(groupBefore); // no new group created
  });
});

describe("acquireDailyRentalHold — audit", () => {
  it("writes ONE success audit on the hold GROUP with structured, non-sensitive fields (owner id only)", async () => {
    const { db, audits } = makeDb(RANGE);
    await run(db, { dateKeys: ["2030-07-10", "2030-07-11"] });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("rental.daily_hold_acquired");
    expect(audits[0]!.entityType).toBe("RentalVehicleDayHoldGroup");
    expect(audits[0]!.actorId).toBe(CUST);
    expect(JSON.stringify(audits[0]!.newValue)).not.toMatch(/holdToken|registrationNumber|passenger/i);
  });
  it("writes NO audit on a failed acquisition (capacity)", async () => {
    const { db, audits } = makeDb({ ...RANGE, offering: { bookableCapacity: 2 } });
    await run(db, { passengerCount: 5 });
    expect(audits).toHaveLength(0);
  });
});
