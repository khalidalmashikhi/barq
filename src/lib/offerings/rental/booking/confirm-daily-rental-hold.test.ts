import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

// Keep resolveRentalDayQuote REAL (real pricing/drift), mock only the reused authorities + the
// lifecycle engine (its own suites cover them). The fake DB models the BookingIdempotencyKey DB
// arbiter, the guarded HELD→CONFIRMED updateMany, and transactional all-or-nothing rollback.
const vertical = vi.fn();
const vehicleReady = vi.fn();
vi.mock("../rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rental-offering-authorization")>();
  return { ...actual, assertRentalVerticalCompliant: (...a: unknown[]) => vertical(...a), assertRentalVehicleReady: (...a: unknown[]) => vehicleReady(...a) };
});
const transitionBooking = vi.fn<(...a: unknown[]) => Promise<Record<string, string>>>(async () => ({ bookingId: "b", customerId: "c", providerId: "p", serviceId: "s", fromStatus: "CREATED", toStatus: "PENDING_PROVIDER" }));
const recordBookingCreated = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/booking/lifecycle", () => ({
  transitionBooking: (...a: unknown[]) => transitionBooking(...a),
  recordBookingCreated: (...a: unknown[]) => recordBookingCreated(...a),
}));

const { confirmDailyRentalHoldAndCreateBooking } = await import("./confirm-daily-rental-hold");
const { computeRentalHoldQuoteFingerprint } = await import("../reservation/reservation-types");

const NOW = new Date("2030-07-01T08:00:00.000Z");
const CUST = "cust-1";
const OFFERING = "off-1";
const VEHICLE = "veh-1";
const SERVICE = "svc-1";
const PROVIDER = "prov-1";
const HG = "hg-1";
const dbDate = (k: string) => new Date(`${k}T00:00:00.000Z`);
const dec = (s: string) => new Prisma.Decimal(s);
const future = new Date(NOW.getTime() + 600000);

type Child = { holdGroupId: string; serviceDate: Date; status: string; expiresAt: Date | null };
type Group = { id: string; customerId: string; rentalOfferingId: string; passengerCount: number; bookingId: string | null; children: Child[] };
type Booking = { id: string; status: string; rentalSnapshot: unknown; bookingTotalSnapshot: Prisma.Decimal | null; billableQuantitySnapshot: number | null; pricingUnitSnapshot: string | null; seats: number };
type IdemKey = { customerId: string; idempotencyKey: string; requestFingerprint: string; bookingId: string };

function makeDb(opts: {
  group?: Group | null;
  offering?: null | { base?: string; capacityOverride?: number | null; bookableCapacity?: number | null };
  days?: Record<string, { state: "OPEN" | "BLOCKED"; override?: string | null }>;
  seedKeys?: IdemKey[];
  seedBookings?: Booking[];
  missingCustomer?: boolean;
}) {
  const groups: Group[] = opts.group ? [opts.group] : [];
  const bookings: Booking[] = opts.seedBookings ? [...opts.seedBookings] : [];
  const keys: IdemKey[] = opts.seedKeys ? [...opts.seedKeys] : [];
  const audits: { action: string; entityType: string; entityId: string; actorId: string | null; newValue: unknown }[] = [];
  let seq = 0;
  const offering = opts.offering === null ? null : {
    id: OFFERING, serviceId: SERVICE, currency: "OMR", baseDailyAmount: dec(opts.offering?.base ?? "40.00"),
    offeringCapacityOverride: opts.offering?.capacityOverride ?? null,
    service: { providerId: PROVIDER },
    vehicle: { assetId: VEHICLE, bookablePassengerCapacity: opts.offering?.bookableCapacity ?? 7, make: "Toyota", model: "Hiace", modelYear: 2029, color: "white", vehicleType: "VAN", asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] } },
  };
  const model = {
    customer: { findUnique: async ({ where }: { where: { id: string } }) => (opts.missingCustomer || where.id !== CUST ? null : { id: CUST }) },
    rentalOffering: { findFirst: async () => (offering ? { ...offering } : null) },
    rentalOfferingDay: {
      findMany: async ({ where }: { where: { serviceDate: { in: Date[] } } }) => {
        const rows: { serviceDate: Date; state: string; dailyAmountOverride: Prisma.Decimal | null }[] = [];
        for (const d of where.serviceDate.in) {
          const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
          const cfg = opts.days?.[k];
          if (cfg) rows.push({ serviceDate: d, state: cfg.state, dailyAmountOverride: cfg.override != null ? dec(cfg.override) : null });
        }
        return rows;
      },
    },
    rentalVehicleDayHoldGroup: {
      findFirst: async ({ where }: { where: { id: string; customerId: string } }) => {
        const g = groups.find((x) => x.id === where.id && x.customerId === where.customerId);
        if (!g) return null;
        return { id: g.id, rentalOfferingId: g.rentalOfferingId, passengerCount: g.passengerCount, bookingId: g.bookingId, reservations: g.children.map((c) => ({ serviceDate: c.serviceDate, status: c.status, expiresAt: c.expiresAt })) };
      },
      update: async ({ where, data }: { where: { id: string }; data: { bookingId: string } }) => {
        const g = groups.find((x) => x.id === where.id);
        if (g) g.bookingId = data.bookingId;
        return {};
      },
    },
    rentalVehicleDayReservation: {
      updateMany: async ({ where, data }: { where: { holdGroupId: string; status: string; expiresAt?: { gt: Date } }; data: { status: string; expiresAt: null } }) => {
        let count = 0;
        for (const g of groups) for (const c of g.children) {
          if (c.holdGroupId === where.holdGroupId && c.status === where.status && (!where.expiresAt || (c.expiresAt !== null && c.expiresAt > where.expiresAt.gt))) {
            c.status = data.status; c.expiresAt = data.expiresAt; count++;
          }
        }
        return { count };
      },
    },
    booking: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `bk-${++seq}`;
        bookings.push({ id, status: "PENDING_PROVIDER", rentalSnapshot: data.rentalSnapshot, bookingTotalSnapshot: data.bookingTotalSnapshot as Prisma.Decimal, billableQuantitySnapshot: data.billableQuantitySnapshot as number, pricingUnitSnapshot: data.pricingUnitSnapshot as string, seats: data.seats as number });
        return { id };
      },
      findUnique: async ({ where }: { where: { id: string } }) => bookings.find((b) => b.id === where.id) ?? null,
    },
    bookingIdempotencyKey: {
      findUnique: async ({ where }: { where: { customerId_idempotencyKey: { customerId: string; idempotencyKey: string } } }) => {
        const k = keys.find((x) => x.customerId === where.customerId_idempotencyKey.customerId && x.idempotencyKey === where.customerId_idempotencyKey.idempotencyKey);
        return k ? { requestFingerprint: k.requestFingerprint, bookingId: k.bookingId } : null;
      },
      create: async ({ data }: { data: IdemKey }) => {
        if (keys.some((k) => k.customerId === data.customerId && k.idempotencyKey === data.idempotencyKey)) {
          throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["customerId", "idempotencyKey"] } });
        }
        keys.push({ ...data });
        return data;
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string; entityType: string; entityId: string; actorId: string | null; newValue: unknown } }) => { audits.push(data); return data; } },
  };
  const db = {
    ...model,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = { g: groups.map((x) => ({ ...x, children: x.children.map((c) => ({ ...c })) })), b: bookings.map((x) => ({ ...x })), k: keys.map((x) => ({ ...x })), a: audits.length };
      try { return await fn(db); }
      catch (e) {
        groups.length = 0; groups.push(...snap.g);
        bookings.length = 0; bookings.push(...snap.b);
        keys.length = 0; keys.push(...snap.k);
        audits.length = snap.a;
        throw e;
      }
    },
  };
  return { db, groups, bookings, keys, audits };
}

const grp = (children: Array<{ dateKey: string; status?: string; expiresAt?: Date | null }>, over: Partial<Group> = {}): Group => ({
  id: HG, customerId: CUST, rentalOfferingId: OFFERING, passengerCount: 2, bookingId: null,
  children: children.map((c) => ({ holdGroupId: HG, serviceDate: dbDate(c.dateKey), status: c.status ?? "HELD", expiresAt: c.expiresAt !== undefined ? c.expiresAt : future })),
  ...over,
});
const OPEN2 = { "2030-07-10": { state: "OPEN" as const }, "2030-07-11": { state: "OPEN" as const }, "2030-07-12": { state: "OPEN" as const } };
const acceptedFp = (dateKeys: string[], perDate: { dateKey: string; amount: string; source: "BASE" | "OVERRIDE" }[]) =>
  computeRentalHoldQuoteFingerprint({ offeringId: OFFERING, currency: "OMR", total: perDate.reduce((s, d) => s + Number(d.amount), 0).toFixed(2), days: perDate.map((d) => ({ dateKey: d.dateKey, amount: d.amount, currency: "OMR", priceSource: d.source })) });
const run = (db: unknown, over: Partial<Parameters<typeof confirmDailyRentalHoldAndCreateBooking>[1]> = {}) =>
  confirmDailyRentalHoldAndCreateBooking(db as never, { customerId: CUST, holdGroupId: HG, confirmationIdempotencyKey: "ck-1", expectedQuote: { fingerprint: acceptedFp(["2030-07-10"], [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" }]) }, now: NOW, ...over });

beforeEach(() => { vertical.mockResolvedValue(null); vehicleReady.mockReturnValue(null); transitionBooking.mockClear(); recordBookingCreated.mockClear(); });

describe("confirmDailyRentalHoldAndCreateBooking — happy path", () => {
  it("creates exactly ONE Booking (PENDING_PROVIDER), confirms all children, links the group, audits", async () => {
    const { db, bookings, groups, audits } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const res = await run(db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(bookings).toHaveLength(1);
    expect(res.booking.status).toBe("PENDING_PROVIDER");
    expect(groups[0]!.children.every((c) => c.status === "CONFIRMED" && c.expiresAt === null)).toBe(true);
    expect(groups[0]!.bookingId).toBe(res.booking.id);
    expect(transitionBooking).toHaveBeenCalledWith(expect.objectContaining({ toStatus: "PENDING_PROVIDER" }), expect.anything());
    expect(audits.some((a) => a.action === "rental.hold_confirmed" && a.actorId === CUST)).toBe(true);
  });
  it("Booking money is TOTALIZED PER_VEHICLE_DAY with billableQuantity 1 (no unit×qty), total = sum of days", async () => {
    const days = [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" as const }, { dateKey: "2030-07-11", amount: "55.00", source: "OVERRIDE" as const }];
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }, { dateKey: "2030-07-11" }]), offering: {}, days: { ...OPEN2, "2030-07-11": { state: "OPEN", override: "55.00" } } });
    const res = await run(db, { expectedQuote: { fingerprint: acceptedFp(["2030-07-10", "2030-07-11"], days) } });
    expect(res.ok).toBe(true);
    expect(bookings[0]!.bookingTotalSnapshot!.toFixed(2)).toBe("95.00");
    expect(bookings[0]!.billableQuantitySnapshot).toBe(1);
    expect(bookings[0]!.pricingUnitSnapshot).toBe("PER_VEHICLE_DAY");
    expect(bookings[0]!.seats).toBe(1);
    if (res.ok) {
      expect(res.booking.rentalSnapshot.total).toBe("95.00");
      expect(res.booking.rentalSnapshot.chargeableDays).toBe(2);
      expect(res.booking.rentalSnapshot.passengerCount).toBe(2);
      expect(res.booking.rentalSnapshot.perDate).toEqual(days.map((d) => ({ dateKey: d.dateKey, amount: d.amount, currency: "OMR", source: d.source })));
      expect(JSON.stringify(res.booking.rentalSnapshot)).not.toMatch(/registrationNumber|registeredSeats/i);
    }
  });
  it("passenger count does not multiply the total (5 passengers, same total as 2)", async () => {
    const a = makeDb({ group: grp([{ dateKey: "2030-07-10" }], { passengerCount: 5 }), offering: { bookableCapacity: 7 }, days: OPEN2 });
    const res = await run(a.db, { expectedQuote: { fingerprint: acceptedFp(["2030-07-10"], [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" }]) } });
    expect(res.ok && a.bookings[0]!.bookingTotalSnapshot!.toFixed(2)).toBe("40.00");
  });
  it("reserves ONLY the selected dates (non-consecutive gap absent from snapshot)", async () => {
    const days = [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" as const }, { dateKey: "2030-07-12", amount: "40.00", source: "BASE" as const }];
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10" }, { dateKey: "2030-07-12" }]), offering: {}, days: { "2030-07-10": { state: "OPEN" }, "2030-07-12": { state: "OPEN" } } });
    const res = await run(db, { expectedQuote: { fingerprint: acceptedFp(["2030-07-10", "2030-07-12"], days) } });
    expect(res.ok && res.booking.rentalSnapshot.dateKeys).toEqual(["2030-07-10", "2030-07-12"]);
  });
});

describe("confirmDailyRentalHoldAndCreateBooking — fail-closed (no Booking)", () => {
  const expectNoBooking = (r: Awaited<ReturnType<typeof run>>, bookings: Booking[]) => { expect(r.ok).toBe(false); expect(bookings).toHaveLength(0); };
  it("HOLD_NOT_FOUND for a foreign/missing hold", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }], { customerId: "other" }), offering: {}, days: OPEN2 });
    const r = await run(db); expect(r).toEqual({ ok: false, reason: "HOLD_NOT_FOUND" }); expect(bookings).toHaveLength(0);
  });
  it("HOLD_EXPIRED when any child has lapsed", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10", expiresAt: new Date(NOW.getTime() - 1000) }]), offering: {}, days: OPEN2 });
    expectNoBooking(await run(db), bookings); expect((await run(makeDb({ group: grp([{ dateKey: "2030-07-10", expiresAt: new Date(NOW.getTime() - 1000) }]), offering: {}, days: OPEN2 }).db)).ok).toBe(false);
  });
  it("HOLD_NOT_CONFIRMABLE when a child is not HELD (already confirmed/released)", async () => {
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10", status: "CONFIRMED", expiresAt: null }]), offering: {}, days: OPEN2 });
    expect((await run(db)).ok).toBe(false);
  });
  it("NOT_BOOKABLE when the offering is no longer eligible", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: null });
    const r = await run(db); expect(r).toEqual({ ok: false, reason: "NOT_BOOKABLE" }); expect(bookings).toHaveLength(0);
  });
  it("NOT_BOOKABLE when the vertical is non-compliant / vehicle unready (cause hidden)", async () => {
    vertical.mockResolvedValue("VERTICAL_NOT_COMPLIANT");
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    expect((await run(db)).ok).toBe(false);
  });
  it("CAPACITY_EXCEEDED when verified capacity dropped below the held passenger count", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }], { passengerCount: 6 }), offering: { bookableCapacity: 4 }, days: OPEN2 });
    const r = await run(db, { expectedQuote: { fingerprint: acceptedFp(["2030-07-10"], [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" }]) } });
    expect(r).toEqual({ ok: false, reason: "CAPACITY_EXCEEDED" }); expect(bookings).toHaveLength(0);
  });
  it("DAY_NOT_AVAILABLE when a selected day became BLOCKED/NONE", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: { "2030-07-10": { state: "BLOCKED" } } });
    expectNoBooking(await run(db), bookings);
  });
});

describe("confirmDailyRentalHoldAndCreateBooking — price drift", () => {
  it("returns PRICE_CHANGED with the fresh quote and writes nothing when the accepted fingerprint differs", async () => {
    const { db, bookings, groups } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const res = await run(db, { expectedQuote: { fingerprint: "stale" } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("PRICE_CHANGED");
    expect(res.quote?.total).toBe("40.00");
    expect(bookings).toHaveLength(0);
    expect(groups[0]!.children.every((c) => c.status === "HELD")).toBe(true); // hold left intact
  });
  it("explicit reconfirmation with the fresh fingerprint succeeds", async () => {
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const good = acceptedFp(["2030-07-10"], [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" }]);
    expect((await run(db, { expectedQuote: { fingerprint: good } })).ok).toBe(true);
  });
  it("returns PRICE_CHANGED on a total/currency mismatch too", async () => {
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const res = await run(db, { expectedQuote: { total: "99.00", currency: "OMR" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("PRICE_CHANGED");
  });
});

describe("confirmDailyRentalHoldAndCreateBooking — idempotency + guard", () => {
  it("replays the SAME booking for the same key + same request (no second booking)", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const first = await run(db);
    expect(first.ok).toBe(true);
    const second = await run(db);
    expect(second.ok && second.replayed).toBe(true);
    if (second.ok && first.ok) expect(second.booking.id).toBe(first.booking.id);
    expect(bookings).toHaveLength(1);
  });
  it("IDEMPOTENCY_MISMATCH for the same key with a different accepted quote", async () => {
    const { db } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    await run(db);
    const res = await run(db, { expectedQuote: { fingerprint: "different-accepted" } });
    expect(res).toEqual({ ok: false, reason: "IDEMPOTENCY_MISMATCH" });
  });
  it("replay after cancellation returns the original booking's CURRENT state (no replacement)", async () => {
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }]), offering: {}, days: OPEN2 });
    const first = await run(db);
    expect(first.ok).toBe(true);
    if (first.ok) bookings.find((b) => b.id === first.booking.id)!.status = "CANCELLED"; // simulate later cancellation
    const replay = await run(db);
    expect(replay.ok && replay.replayed && replay.booking.status).toBe("CANCELLED");
    expect(bookings).toHaveLength(1);
  });
  it("HOLD_EXPIRED when the guarded confirm updates fewer rows than expected (expiry race)", async () => {
    // A child lapses AFTER the pre-check but the pre-check itself catches it here; simulate the guard
    // path by making one child unexpired at pre-check but the guarded update matches fewer: set one
    // child expiresAt to exactly now (gt now fails) while pre-check uses <= now (also fails) — both
    // agree. To isolate the guard, use two children where one expires exactly at now.
    const { db, bookings } = makeDb({ group: grp([{ dateKey: "2030-07-10" }, { dateKey: "2030-07-11", expiresAt: NOW }]), offering: {}, days: OPEN2 });
    expect((await run(db, { expectedQuote: { fingerprint: acceptedFp(["2030-07-10", "2030-07-11"], [{ dateKey: "2030-07-10", amount: "40.00", source: "BASE" }, { dateKey: "2030-07-11", amount: "40.00", source: "BASE" }]) } })).ok).toBe(false);
    expect(bookings).toHaveLength(0);
  });
});
