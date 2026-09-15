import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return {
    ...actual,
    resolveApprovedProvider: vi.fn(),
    loadOwnedServiceAndVehicleForCreate: vi.fn(),
    loadOwnedRentalOffering: vi.fn(),
    assertRentalDraftAuthorized: vi.fn(),
    assertRentalPublishReady: vi.fn(),
    assertRentalEditAuthorized: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: vi.fn().mockResolvedValue({ id: "audit" }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import {
  resolveApprovedProvider,
  loadOwnedServiceAndVehicleForCreate,
  loadOwnedRentalOffering,
  assertRentalDraftAuthorized,
  assertRentalPublishReady,
  assertRentalEditAuthorized,
  type LoadedRentalOffering,
} from "./rental-offering-authorization";
import { createRentalOffering } from "./create-rental-offering";
import { updateRentalOffering } from "./update-rental-offering";
import { publishRentalOffering, suspendRentalOffering, archiveRentalOffering } from "./transition-rental-offering";
import { bulkOpenRentalDays } from "./bulk-open-days";
import { blockRentalDay } from "./block-day";
import { setDailyOverride } from "./set-daily-override";
import { manageStartTimes } from "./manage-start-times";

const PROVIDER = "prov-1";
const OFFERING = "01a028ad-0000-7000-8000-000000000010";
const SERVICE = "01a028ad-0000-7000-8000-000000000011";
const VEHICLE = "01a028ad-0000-7000-8000-000000000012";
// A fixed "now" well in the future so hard-coded calendar dates below are unambiguously future.
const NOW = new Date("2030-06-15T08:00:00.000Z");
const D1 = "2030-07-01";
const D2 = "2030-07-02";
const D3 = "2030-07-03";
const dbDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

// A configurable fake transaction client — only the delegate methods the mutations call after the
// (mocked) resource load are implemented.
type TxOver = Partial<{
  dayFindUnique: unknown;
  dayFindFirst: unknown;
  dayFindMany: unknown[];
  dayCreateMany: { count: number };
  dayUpdateMany: { count: number };
  offeringUpdateMany: { count: number };
  offeringCreate: unknown;
  startFindMany: unknown[];
  startCreateMany: { count: number };
  startUpdateMany: { count: number };
}>;

function makeTx(over: TxOver = {}) {
  const fns = {
    dayFindUnique: vi.fn().mockResolvedValue(over.dayFindUnique ?? null),
    dayFindFirst: vi.fn().mockResolvedValue(over.dayFindFirst ?? null),
    dayFindMany: vi.fn().mockResolvedValue(over.dayFindMany ?? []),
    dayCreateMany: vi.fn().mockResolvedValue(over.dayCreateMany ?? { count: 0 }),
    dayUpdateMany: vi.fn().mockResolvedValue(over.dayUpdateMany ?? { count: 0 }),
    offeringUpdateMany: vi.fn().mockResolvedValue(over.offeringUpdateMany ?? { count: 1 }),
    offeringCreate: vi.fn().mockImplementation(() => Promise.resolve(over.offeringCreate ?? null)),
    startFindMany: vi.fn().mockResolvedValue(over.startFindMany ?? []),
    startCreateMany: vi.fn().mockResolvedValue(over.startCreateMany ?? { count: 0 }),
    startUpdateMany: vi.fn().mockResolvedValue(over.startUpdateMany ?? { count: 0 }),
  };
  const tx = {
    rentalOffering: { create: fns.offeringCreate, updateMany: fns.offeringUpdateMany },
    rentalOfferingDay: {
      findUnique: fns.dayFindUnique,
      findFirst: fns.dayFindFirst,
      findMany: fns.dayFindMany,
      createMany: fns.dayCreateMany,
      updateMany: fns.dayUpdateMany,
    },
    rentalStartTime: { findMany: fns.startFindMany, createMany: fns.startCreateMany, updateMany: fns.startUpdateMany },
  };
  return { tx, fns };
}

function loaded(over: Partial<LoadedRentalOffering> = {}): LoadedRentalOffering {
  return {
    id: OFFERING,
    serviceId: SERVICE,
    vehicleId: VEHICLE,
    status: "DRAFT",
    baseDailyAmount: new Prisma.Decimal("40.00"),
    currency: "OMR",
    offeringCapacityOverride: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-02T00:00:00.000Z"),
    serviceOfferingKind: "VEHICLE_RENTAL",
    vehicle: {
      assetId: VEHICLE,
      bookablePassengerCapacity: 7,
      asset: { providerId: PROVIDER, assetType: "VEHICLE", status: "ACTIVE", verificationStatus: "APPROVED", documents: [] },
    },
    ...over,
  };
}

/** Wire prisma.$transaction to run the callback with the given fake tx. */
function useTx(tx: unknown) {
  (prisma.$transaction as unknown as Mock).mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveApprovedProvider as Mock).mockResolvedValue({ ok: true, providerId: PROVIDER });
  (assertRentalDraftAuthorized as Mock).mockResolvedValue(null);
  (assertRentalPublishReady as Mock).mockResolvedValue(null);
  (assertRentalEditAuthorized as Mock).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------------------------
describe("createRentalOffering", () => {
  it("propagates a resource-load failure (e.g. WRONG_SERVICE_KIND)", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedServiceAndVehicleForCreate as Mock).mockResolvedValue({ ok: false, error: "WRONG_SERVICE_KIND" });
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR" })).toEqual({ ok: false, error: "WRONG_SERVICE_KIND" });
  });

  it("creates a DRAFT, writes an audit event, and returns the allowlisted DTO", async () => {
    const created = {
      id: OFFERING,
      serviceId: SERVICE,
      vehicleId: VEHICLE,
      status: "DRAFT",
      baseDailyAmount: new Prisma.Decimal("40.00"),
      currency: "OMR",
      offeringCapacityOverride: 4,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    const { tx, fns } = makeTx({ offeringCreate: created });
    useTx(tx);
    (loadOwnedServiceAndVehicleForCreate as Mock).mockResolvedValue({ ok: true, value: { serviceOfferingKind: "VEHICLE_RENTAL", vehicle: loaded().vehicle } });
    const res = await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "omr", offeringCapacityOverride: 4 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({ id: OFFERING, status: "DRAFT", baseDailyAmount: "40.00", currency: "OMR", effectiveCapacity: 4, verifiedVehicleCapacity: 7 });
    }
    expect(fns.offeringCreate).toHaveBeenCalledTimes(1);
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.created", actorId: PROVIDER });
  });

  it("maps a P2002 unique violation to OFFERING_ALREADY_ACTIVE", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedServiceAndVehicleForCreate as Mock).mockResolvedValue({ ok: true, value: { serviceOfferingKind: "VEHICLE_RENTAL", vehicle: loaded().vehicle } });
    tx.rentalOffering.create = vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR" })).toEqual({ ok: false, error: "OFFERING_ALREADY_ACTIVE" });
  });

  it("rejects an override above the vehicle's verified capacity (checkCapacityOverride)", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedServiceAndVehicleForCreate as Mock).mockResolvedValue({ ok: true, value: { serviceOfferingKind: "VEHICLE_RENTAL", vehicle: loaded().vehicle } });
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR", offeringCapacityOverride: 8 })).toEqual({ ok: false, error: "INVALID_CAPACITY_OVERRIDE" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("updateRentalOffering", () => {
  it("refuses to touch an ARCHIVED offering", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "ARCHIVED" }));
    expect(await updateRentalOffering({ offeringId: OFFERING, baseDailyAmount: "50.00" })).toEqual({ ok: false, error: "OFFERING_ARCHIVED" });
  });

  it("blocks a currency change unless DRAFT (CURRENCY_LOCKED)", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "PUBLISHED" }));
    expect(await updateRentalOffering({ offeringId: OFFERING, currency: "USD" })).toEqual({ ok: false, error: "CURRENCY_LOCKED" });
  });

  it("blocks a DRAFT currency change while any day carries a price override (CURRENCY_OVERRIDES_PRESENT)", async () => {
    const { tx } = makeTx({ dayFindFirst: { id: "day-x" } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    expect(await updateRentalOffering({ offeringId: OFFERING, currency: "USD" })).toEqual({ ok: false, error: "CURRENCY_OVERRIDES_PRESENT" });
  });

  it("returns OFFERING_STATE_CONFLICT when the guarded updateMany matches nothing", async () => {
    const { tx } = makeTx({ offeringUpdateMany: { count: 0 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    expect(await updateRentalOffering({ offeringId: OFFERING, baseDailyAmount: "50.00" })).toEqual({ ok: false, error: "OFFERING_STATE_CONFLICT" });
  });

  it("applies an amount change and audits previous→new", async () => {
    const { tx, fns } = makeTx({ offeringUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT", baseDailyAmount: new Prisma.Decimal("40.00") }));
    const res = await updateRentalOffering({ offeringId: OFFERING, baseDailyAmount: "55.50" });
    expect(res.ok && res.value.baseDailyAmount).toBe("55.50");
    expect(fns.offeringUpdateMany).toHaveBeenCalledTimes(1);
    const audit = (recordAuditEvent as Mock).mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "rental_offering.updated", previousValue: { baseDailyAmount: "40.00" }, newValue: { baseDailyAmount: "55.50" } });
  });
});

// ---------------------------------------------------------------------------------------------
describe("publishRentalOffering", () => {
  it("is an idempotent no-op when already PUBLISHED (no updateMany)", async () => {
    const { tx, fns } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "PUBLISHED" }));
    const res = await publishRentalOffering(OFFERING, NOW);
    expect(res.ok && res.value.status).toBe("PUBLISHED");
    expect(fns.offeringUpdateMany).not.toHaveBeenCalled();
  });

  it("propagates a readiness blocker", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    (assertRentalPublishReady as Mock).mockResolvedValue("VEHICLE_NOT_SELECTABLE");
    expect(await publishRentalOffering(OFFERING, NOW)).toEqual({ ok: false, error: "VEHICLE_NOT_SELECTABLE" });
  });

  it("requires at least one OPEN non-past day (NO_PUBLISHABLE_DAY)", async () => {
    const { tx } = makeTx({ dayFindFirst: null }); // no publishable day
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    expect(await publishRentalOffering(OFFERING, NOW)).toEqual({ ok: false, error: "NO_PUBLISHABLE_DAY" });
  });

  it("publishes DRAFT→PUBLISHED with an OPEN day and audits", async () => {
    const { tx, fns } = makeTx({ dayFindFirst: { id: "day-1" }, offeringUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    const res = await publishRentalOffering(OFFERING, NOW);
    expect(res.ok && res.value.status).toBe("PUBLISHED");
    expect(fns.offeringUpdateMany).toHaveBeenCalledTimes(1);
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.published" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("suspend / archive transitions", () => {
  it("suspends PUBLISHED→SUSPENDED", async () => {
    const { tx } = makeTx({ offeringUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "PUBLISHED" }));
    const res = await suspendRentalOffering(OFFERING);
    expect(res.ok && res.value.status).toBe("SUSPENDED");
  });

  it("rejects an illegal suspend from DRAFT (guarded updateMany matches nothing → STATE_CONFLICT)", async () => {
    const { tx } = makeTx({ offeringUpdateMany: { count: 0 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "DRAFT" }));
    expect(await suspendRentalOffering(OFFERING)).toEqual({ ok: false, error: "OFFERING_STATE_CONFLICT" });
  });

  it("archives SUSPENDED→ARCHIVED", async () => {
    const { tx } = makeTx({ offeringUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "SUSPENDED" }));
    const res = await archiveRentalOffering(OFFERING);
    expect(res.ok && res.value.status).toBe("ARCHIVED");
  });

  it("re-archiving an ARCHIVED offering is an idempotent no-op; suspending it is refused", async () => {
    const { tx, fns } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "ARCHIVED" }));
    expect((await archiveRentalOffering(OFFERING)).ok).toBe(true);
    expect(fns.offeringUpdateMany).not.toHaveBeenCalled();
    expect(await suspendRentalOffering(OFFERING)).toEqual({ ok: false, error: "OFFERING_ARCHIVED" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("bulkOpenRentalDays", () => {
  it("returns OFFERING_NOT_FOUND when the offering does not load", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(null);
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: [D1] })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
  });

  it("refuses on an ARCHIVED offering", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded({ status: "ARCHIVED" }));
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: [D1] })).toEqual({ ok: false, error: "OFFERING_ARCHIVED" });
  });

  it("rejects a window wider than the maximum inclusive days (DATE_WINDOW_TOO_LARGE)", async () => {
    const { tx } = makeTx();
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    // 2030-07-01 .. 2030-09-30 is > 62 inclusive days.
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: ["2030-07-01", "2030-09-30"] })).toEqual({ ok: false, error: "DATE_WINDOW_TOO_LARGE" });
  });

  it("creates missing days as OPEN, counts existing OPEN, and keeps BLOCKED days when reopenBlocked=false", async () => {
    // D1 already OPEN, D2 BLOCKED, D3 missing.
    const existing = [
      { serviceDate: dbDate(D1), state: "OPEN" },
      { serviceDate: dbDate(D2), state: "BLOCKED" },
    ];
    const { tx, fns } = makeTx({ dayFindMany: existing, dayCreateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await bulkOpenRentalDays({ offeringId: OFFERING, dates: [D1, D2, D3] });
    expect(res.ok && res.value).toEqual({ created: 1, opened: 0, alreadyOpen: 1, blockedKept: 1 });
    // only the missing day is created; no BLOCKED reopen happened.
    expect(fns.dayCreateMany).toHaveBeenCalledTimes(1);
    expect(fns.dayUpdateMany).not.toHaveBeenCalled();
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.days_opened" });
  });

  it("reopens BLOCKED days only when reopenBlocked=true", async () => {
    const existing = [{ serviceDate: dbDate(D2), state: "BLOCKED" }];
    const { tx, fns } = makeTx({ dayFindMany: existing, dayUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await bulkOpenRentalDays({ offeringId: OFFERING, dates: [D2], reopenBlocked: true });
    expect(res.ok && res.value).toEqual({ created: 0, opened: 1, alreadyOpen: 0, blockedKept: 0 });
    expect(fns.dayUpdateMany).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("blockRentalDay", () => {
  it("returns OFFERING_DAY_NOT_FOUND when the day row does not exist (never creates one)", async () => {
    const { tx, fns } = makeTx({ dayFindUnique: null });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    expect(await blockRentalDay({ offeringId: OFFERING, date: D1 })).toEqual({ ok: false, error: "OFFERING_DAY_NOT_FOUND" });
    expect(fns.dayUpdateMany).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op when the day is already BLOCKED", async () => {
    const { tx, fns } = makeTx({ dayFindUnique: { id: "day-1", state: "BLOCKED" } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await blockRentalDay({ offeringId: OFFERING, date: D1 });
    expect(res).toEqual({ ok: true, value: { offeringId: OFFERING, date: D1, state: "BLOCKED" } });
    expect(fns.dayUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks an OPEN day and audits (start-times/override untouched)", async () => {
    const { tx, fns } = makeTx({ dayFindUnique: { id: "day-1", state: "OPEN" }, dayUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await blockRentalDay({ offeringId: OFFERING, date: D1 });
    expect(res.ok && res.value.state).toBe("BLOCKED");
    expect(fns.dayUpdateMany).toHaveBeenCalledTimes(1);
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.day_blocked" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("setDailyOverride", () => {
  it("returns OFFERING_DAY_NOT_FOUND when the day does not exist (never auto-opens)", async () => {
    const { tx, fns } = makeTx({ dayFindUnique: null });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    expect(await setDailyOverride({ offeringId: OFFERING, date: D1, dailyAmountOverride: "35.00" })).toEqual({ ok: false, error: "OFFERING_DAY_NOT_FOUND" });
    expect(fns.dayUpdateMany).not.toHaveBeenCalled();
  });

  it("sets a positive override and audits set", async () => {
    const { tx } = makeTx({ dayFindUnique: { id: "day-1", dailyAmountOverride: null }, dayUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await setDailyOverride({ offeringId: OFFERING, date: D1, dailyAmountOverride: "35.5" });
    expect(res.ok && res.value.dailyAmountOverride).toBe("35.50");
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.day_override_set" });
  });

  it("clears an existing override (null) and audits clear", async () => {
    const { tx } = makeTx({ dayFindUnique: { id: "day-1", dailyAmountOverride: new Prisma.Decimal("35.00") }, dayUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await setDailyOverride({ offeringId: OFFERING, date: D1, dailyAmountOverride: null });
    expect(res.ok && res.value.dailyAmountOverride).toBeNull();
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.day_override_cleared" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("manageStartTimes", () => {
  it("returns OFFERING_DAY_NOT_FOUND when the day does not exist", async () => {
    const { tx } = makeTx({ dayFindUnique: null });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    expect(await manageStartTimes({ offeringId: OFFERING, date: D1, startTimeMinutes: [540] })).toEqual({ ok: false, error: "OFFERING_DAY_NOT_FOUND" });
  });

  it("diffs desired vs existing: opens new, closes removed, leaves unchanged", async () => {
    // existing: 540 OPEN (kept), 600 OPEN (to close), 660 CLOSED (to reopen). desired: 540, 660, 720(new).
    const existing = [
      { startTimeMinutes: 540, state: "OPEN" },
      { startTimeMinutes: 600, state: "OPEN" },
      { startTimeMinutes: 660, state: "CLOSED" },
    ];
    const { tx, fns } = makeTx({ dayFindUnique: { id: "day-1" }, startFindMany: existing, startCreateMany: { count: 1 }, startUpdateMany: { count: 1 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await manageStartTimes({ offeringId: OFFERING, date: D1, startTimeMinutes: [540, 660, 720] });
    // opened = created(720) + reopened(660) = 2; closed = 600 = 1; unchanged = 540 = 1.
    expect(res.ok && res.value).toEqual({ opened: 2, closed: 1, unchanged: 1 });
    expect(fns.startCreateMany).toHaveBeenCalledTimes(1);
    expect(fns.startUpdateMany).toHaveBeenCalledTimes(2); // one reopen, one close
    expect((recordAuditEvent as Mock).mock.calls[0]![0]).toMatchObject({ action: "rental_offering.day_start_times_set" });
  });

  it("an empty desired set closes every open time (zero-OPEN is valid)", async () => {
    const existing = [
      { startTimeMinutes: 540, state: "OPEN" },
      { startTimeMinutes: 600, state: "OPEN" },
    ];
    const { tx, fns } = makeTx({ dayFindUnique: { id: "day-1" }, startFindMany: existing, startUpdateMany: { count: 2 } });
    useTx(tx);
    (loadOwnedRentalOffering as Mock).mockResolvedValue(loaded());
    const res = await manageStartTimes({ offeringId: OFFERING, date: D1, startTimeMinutes: [] });
    expect(res.ok && res.value).toEqual({ opened: 0, closed: 2, unchanged: 0 });
    expect(fns.startCreateMany).not.toHaveBeenCalled();
  });
});
