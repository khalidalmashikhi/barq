import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

// Phase 3C Slice C3/E2 (correction) — REAL-AUTHORITY concurrency + consistency proof against a
// disposable PostgreSQL with TWO clients. It runs the ACTUAL acquireDailyRentalHold +
// confirmDailyRentalHoldAndCreateBooking (real write order, real BookingIdempotencyKey arbiter, real
// transactions) — only the reused vertical/vehicle COMPLIANCE checks are mocked (their own suites
// cover them), so we need not seed the whole C2b compliance chain. Gated behind RENTAL_DBPROOF=1 so
// the default suite (and CI) never touches a database; run it explicitly:
//   RENTAL_DBPROOF=1 npx vitest run src/lib/offerings/rental/booking/confirm-daily-rental-hold.dbproof.test.ts
const RUN = process.env.RENTAL_DBPROOF === "1";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rental-offering-authorization")>();
  return { ...actual, assertRentalVerticalCompliant: async () => null, assertRentalVehicleReady: () => null };
});

const { acquireDailyRentalHold } = await import("../reservation/acquire-daily-rental-hold");
const { confirmDailyRentalHoldAndCreateBooking } = await import("./confirm-daily-rental-hold");

const PROJECT = process.cwd();
const dbName = "barq_c3e2auth_" + randomUUID().slice(0, 8);
function adminUrl() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path.join(PROJECT, ".env"), "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m && m[1]) env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, ""); }
  const base = env.DATABASE_URL ?? "";
  const u = new URL(base); u.pathname = "/postgres";
  const t = new URL(base); t.pathname = "/" + dbName;
  return { admin: u.toString(), throwaway: t.toString() };
}

let db: PrismaClient, db2: PrismaClient, admin: PrismaClient, throwawayUrl: string;
const CUST = randomUUID(), PROV = randomUUID(), SVC = randomUUID(), VEH = randomUUID(), OFF = randomUUID();

async function seedRaw(client: PrismaClient) {
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`INSERT INTO "providers" ("id","userId","businessName","status","visible","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'{}'::jsonb,'APPROVED'::"ProviderStatus",true,now(),now())`, PROV, randomUUID());
    await tx.$executeRawUnsafe(`INSERT INTO "customers" ("id","userId","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,now(),now())`, CUST, randomUUID());
    await tx.$executeRawUnsafe(`INSERT INTO "services" ("id","providerId","serviceType","name","offeringKind","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'RENTAL','{}'::jsonb,'VEHICLE_RENTAL'::"OfferingKind",'PUBLISHED'::"ServiceStatus",now(),now())`, SVC, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "assets" ("id","providerId","assetType","status","verificationStatus","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,'VEHICLE'::"AssetType",'ACTIVE'::"AssetStatus",'APPROVED'::"AssetVerificationStatus",now(),now())`, VEH, PROV);
    await tx.$executeRawUnsafe(`INSERT INTO "vehicles" ("assetId","passengerCapacity","createdAt","updatedAt") VALUES ($1::uuid,7,now(),now())`, VEH);
    await tx.$executeRawUnsafe(`INSERT INTO "rental_offerings" ("id","serviceId","vehicleId","baseDailyAmount","currency","status","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,'40.00'::numeric,'OMR','PUBLISHED'::"RentalOfferingStatus",now(),now())`, OFF, SVC, VEH);
  });
}
async function seedDay(client: PrismaClient, dateKey: string, override?: string) {
  await client.$executeRawUnsafe(`INSERT INTO "rental_offering_days" ("id","rentalOfferingId","serviceDate","state","dailyAmountOverride","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::date,'OPEN'::"OfferingDayState",${override ? `'${override}'::numeric` : "NULL"},now(),now())`, randomUUID(), OFF, dateKey);
}
const acquireHold = (client: PrismaClient, dateKeys: string[], key: string) =>
  acquireDailyRentalHold(client, { customerId: CUST, offeringId: OFF, dateKeys, passengerCount: 2, idempotencyKey: key, now: new Date("2030-07-01T08:00:00Z") });
const confirm = (client: PrismaClient, holdId: string, ck: string, fp: string) =>
  confirmDailyRentalHoldAndCreateBooking(client, { customerId: CUST, holdGroupId: holdId, confirmationIdempotencyKey: ck, expectedQuote: { fingerprint: fp }, now: new Date("2030-07-01T08:00:00Z") });

beforeAll(async () => {
  if (!RUN) return;
  const urls = adminUrl();
  throwawayUrl = urls.throwaway;
  admin = new PrismaClient({ datasources: { db: { url: urls.admin } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  execSync("npx prisma migrate deploy", { cwd: PROJECT, stdio: "ignore", env: { ...process.env, DATABASE_URL: throwawayUrl, DIRECT_URL: throwawayUrl } });
  db = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  db2 = new PrismaClient({ datasources: { db: { url: throwawayUrl } } });
  await seedRaw(db);
}, 120_000);

afterAll(async () => {
  if (!RUN) return;
  await db?.$disconnect(); await db2?.$disconnect();
  await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid<>pg_backend_pid()`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.$disconnect();
});

describe.runIf(RUN)("confirm authority — REAL two-client concurrency + consistency", () => {
  it("#1/#5 concurrent identical confirmation → ONE Booking, both callers get the SAME booking (loser REPLAYS, not HOLD_NOT_CONFIRMABLE)", async () => {
    await seedDay(db, "2030-08-01");
    const hold = await acquireHold(db, ["2030-08-01"], "acq-1");
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    const fp = hold.hold.quote.quoteFingerprint;
    const before = await db.booking.count();
    const [a, b] = await Promise.all([confirm(db, hold.hold.holdGroupId, "ck-1", fp), confirm(db2, hold.hold.holdGroupId, "ck-1", fp)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.booking.id).toBe(b.booking.id); // both callers → the same logical Booking
    expect(a.replayed !== b.replayed).toBe(true); // exactly one created, one replayed
    expect(await db.booking.count()).toBe(before + 1); // exactly ONE Booking
    expect(await db.bookingIdempotencyKey.count({ where: { idempotencyKey: "ck-1" } })).toBe(1);
    const children = await db.rentalVehicleDayReservation.findMany({ where: { holdGroupId: hold.hold.holdGroupId } });
    expect(children.every((c) => c.status === "CONFIRMED" && c.expiresAt === null)).toBe(true);
  });

  it("#2/#3 same confirmation key reused for a DIFFERENT hold → one winner, the other IDEMPOTENCY_MISMATCH", async () => {
    // Two DISTINCT holds (different dates → different holdGroupIds), each with its OWN valid accepted
    // quote, confirmed under the SAME confirmation key. The fingerprint = sha(holdGroupId + quote), so
    // the second request has a different fingerprint under the same key → mismatch (never a wrong booking).
    await seedDay(db, "2030-08-06");
    await seedDay(db, "2030-08-07");
    const h1 = await acquireHold(db, ["2030-08-06"], "acq-2a");
    const h2 = await acquireHold(db, ["2030-08-07"], "acq-2b");
    expect(h1.ok && h2.ok).toBe(true);
    if (!h1.ok || !h2.ok) return;
    const [a, b] = await Promise.all([
      confirm(db, h1.hold.holdGroupId, "ck-2", h1.hold.quote.quoteFingerprint),
      confirm(db2, h2.hold.holdGroupId, "ck-2", h2.hold.quote.quoteFingerprint),
    ]);
    const oks = [a, b].filter((r) => r.ok).length;
    const mism = [a, b].filter((r) => !r.ok && r.reason === "IDEMPOTENCY_MISMATCH").length;
    expect(oks).toBe(1); // at most one commits under the key
    expect(mism).toBe(1); // the loser sees a different fingerprint under the same key → mismatch
    expect(await db.bookingIdempotencyKey.count({ where: { idempotencyKey: "ck-2" } })).toBe(1);
  });

  it("ISSUE 1 — reconfirmation at a NEW price writes ONE authoritative quote everywhere (group + children + Booking agree)", async () => {
    await seedDay(db, "2030-08-10"); // base 40.00
    const hold = await acquireHold(db, ["2030-08-10"], "acq-3");
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    // Provider raises the day price to 70.00 AFTER the hold (price drift A→B).
    await db.$executeRawUnsafe(`UPDATE "rental_offering_days" SET "dailyAmountOverride"='70.00'::numeric WHERE "rentalOfferingId"=$1::uuid AND "serviceDate"='2030-08-10'::date`, OFF);
    // First confirm with the STALE accepted fingerprint → PRICE_CHANGED, nothing written.
    const drift = await confirm(db, hold.hold.holdGroupId, "ck-3", hold.hold.quote.quoteFingerprint);
    expect(drift.ok).toBe(false);
    if (drift.ok) return;
    expect(drift.reason).toBe("PRICE_CHANGED");
    const freshFp = drift.quote!.quoteFingerprint;
    expect(drift.quote!.total).toBe("70.00");
    // Customer accepts B and reconfirms → succeeds; EVERYTHING now equals B (70.00).
    const ok = await confirm(db, hold.hold.holdGroupId, "ck-3", freshFp);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const group = await db.rentalVehicleDayHoldGroup.findUnique({ where: { id: hold.hold.holdGroupId } });
    const children = await db.rentalVehicleDayReservation.findMany({ where: { holdGroupId: hold.hold.holdGroupId } });
    const booking = await db.booking.findUnique({ where: { id: ok.booking.id } });
    expect(group!.totalAmount.toFixed(2)).toBe("70.00");
    expect(group!.quoteFingerprint).toBe(freshFp);
    expect(children.every((c) => c.dailyAmount.toFixed(2) === "70.00" && c.status === "CONFIRMED")).toBe(true);
    expect((booking!.bookingTotalSnapshot as Prisma.Decimal).toFixed(2)).toBe("70.00");
    expect((ok.booking.rentalSnapshot as { total: string }).total).toBe("70.00");
    expect(booking!.providerResponseDeadlineAt).not.toBeNull(); // Issue 3 deadline set
  });

  it("ISSUE 3 — a rental PENDING_PROVIDER booking past its deadline is expired + children CANCELLED (sweep semantics)", async () => {
    await seedDay(db, "2030-08-20");
    const hold = await acquireHold(db, ["2030-08-20"], "acq-4");
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    const ok = await confirm(db, hold.hold.holdGroupId, "ck-4", hold.hold.quote.quoteFingerprint);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    // Force the deadline into the past, then run the sweep's FAIL-CLOSED selection against this DB.
    const past = new Date("2020-01-01T00:00:00Z");
    await db.booking.update({ where: { id: ok.booking.id }, data: { providerResponseDeadlineAt: past } });

    // Insert a NON-rental booking with a STRAY expired deadline (rentalSnapshot SQL NULL, no
    // availability) — the exact false-positive the correction guards against.
    const strayId = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(
        `INSERT INTO "bookings" ("id","customerId","serviceId","providerId","status","seats","providerResponseDeadlineAt","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'PENDING_PROVIDER'::"BookingStatus",1,$5::timestamptz,now(),now())`,
        strayId, CUST, SVC, PROV, past.toISOString(),
      );
    });

    // The OLD deadline-only predicate WOULD have swept the stray non-rental booking (the bug).
    const oldPredicate = await db.booking.findMany({ where: { status: "PENDING_PROVIDER", providerResponseDeadlineAt: { lte: new Date() } }, select: { id: true } });
    expect(oldPredicate.some((s) => s.id === strayId)).toBe(true);

    // The NEW fail-closed predicate (`rentalSnapshot` non-null AND deadline passed) selects the real
    // rental but EXCLUDES the stray non-rental booking — proven against real PostgreSQL.
    const stale = await db.booking.findMany({ where: { status: "PENDING_PROVIDER", OR: [{ rentalSnapshot: { not: Prisma.DbNull }, providerResponseDeadlineAt: { lte: new Date() } }] }, select: { id: true } });
    expect(stale.some((s) => s.id === ok.booking.id)).toBe(true);
    expect(stale.some((s) => s.id === strayId)).toBe(false);
    await db.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: ok.booking.id }, data: { status: "EXPIRED" } });
      const groups = await tx.rentalVehicleDayHoldGroup.findMany({ where: { bookingId: ok.booking.id }, select: { id: true } });
      await tx.rentalVehicleDayReservation.updateMany({ where: { holdGroupId: { in: groups.map((g) => g.id) }, status: "CONFIRMED" }, data: { status: "CANCELLED", releasedAt: new Date() } });
    });
    const b = await db.booking.findUnique({ where: { id: ok.booking.id } });
    const children = await db.rentalVehicleDayReservation.findMany({ where: { holdGroupId: hold.hold.holdGroupId } });
    expect(b!.status).toBe("EXPIRED");
    expect(children.every((c) => c.status === "CANCELLED")).toBe(true);
  });
});
