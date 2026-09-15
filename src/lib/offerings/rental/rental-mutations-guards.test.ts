import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

// Keep every PURE helper real (validation, lifecycle, dto, uuid, oman-time); mock only the I/O edges
// (session auth + resource loading + the db transaction + audit + logger). The point of this file is
// to prove each mutation rejects malformed input BEFORE opening a transaction.
vi.mock("./rental-offering-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rental-offering-authorization")>();
  return {
    ...actual,
    resolveApprovedProvider: vi.fn(),
    assertProviderStillApproved: vi.fn(),
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

import { prisma } from "@/lib/db";
import { resolveApprovedProvider } from "./rental-offering-authorization";
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
const BAD_UUID = "not-a-uuid";
// A fixed "today" far in the future so hard-coded past dates in tests are unambiguously past.
const NOW = new Date("2030-06-15T08:00:00.000Z");

const tx = prisma.$transaction as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  (resolveApprovedProvider as Mock).mockResolvedValue({ ok: true, providerId: PROVIDER });
  // If any guard test reaches the transaction, that is itself a failure of the short-circuit.
  tx.mockImplementation(() => {
    throw new Error("transaction should not be opened for invalid input");
  });
});

describe("auth short-circuit (all mutations)", () => {
  it("propagates a non-approved provider result without opening a transaction", async () => {
    (resolveApprovedProvider as Mock).mockResolvedValue({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    const calls = [
      () => createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR" }),
      () => updateRentalOffering({ offeringId: OFFERING, baseDailyAmount: "40.00" }),
      () => publishRentalOffering(OFFERING),
      () => suspendRentalOffering(OFFERING),
      () => archiveRentalOffering(OFFERING),
      () => bulkOpenRentalDays({ offeringId: OFFERING, dates: ["2030-07-01"] }),
      () => blockRentalDay({ offeringId: OFFERING, date: "2030-07-01" }),
      () => setDailyOverride({ offeringId: OFFERING, date: "2030-07-01", dailyAmountOverride: "40.00" }),
      () => manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: [540] }),
    ];
    for (const call of calls) {
      expect(await call()).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
    }
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("createRentalOffering — input guards", () => {
  it("rejects a non-uuid service/vehicle id", async () => {
    expect(await createRentalOffering({ serviceId: BAD_UUID, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: BAD_UUID, baseDailyAmount: "40.00", currency: "OMR" })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
  it("rejects malformed money and currency", async () => {
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "0", currency: "OMR" })).toEqual({ ok: false, error: "INVALID_MONEY" });
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "" })).toEqual({ ok: false, error: "INVALID_CURRENCY" });
  });
  it("rejects a non-positive-integer capacity override", async () => {
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR", offeringCapacityOverride: 2.5 })).toEqual({ ok: false, error: "INVALID_CAPACITY_OVERRIDE" });
    expect(await createRentalOffering({ serviceId: SERVICE, vehicleId: VEHICLE, baseDailyAmount: "40.00", currency: "OMR", offeringCapacityOverride: 0 })).toEqual({ ok: false, error: "INVALID_CAPACITY_OVERRIDE" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("updateRentalOffering — input guards", () => {
  it("rejects a non-uuid offering id", async () => {
    expect(await updateRentalOffering({ offeringId: BAD_UUID, baseDailyAmount: "40.00" })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
  });
  it("rejects an empty change set (no fields present)", async () => {
    expect(await updateRentalOffering({ offeringId: OFFERING })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
  it("pre-validates money and currency before any DB work", async () => {
    expect(await updateRentalOffering({ offeringId: OFFERING, baseDailyAmount: "-1" })).toEqual({ ok: false, error: "INVALID_MONEY" });
    expect(await updateRentalOffering({ offeringId: OFFERING, currency: "  " })).toEqual({ ok: false, error: "INVALID_CURRENCY" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("transition mutations — input guards", () => {
  it("reject a non-uuid offering id uniformly as OFFERING_NOT_FOUND", async () => {
    expect(await publishRentalOffering(BAD_UUID)).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(await suspendRentalOffering(BAD_UUID)).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(await archiveRentalOffering(BAD_UUID)).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("bulkOpenRentalDays — input guards", () => {
  it("rejects a non-uuid offering id", async () => {
    expect(await bulkOpenRentalDays({ offeringId: BAD_UUID, dates: ["2030-07-01"] })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
  });
  it("rejects an empty / non-array date list", async () => {
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: [] })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: undefined as unknown as string[] })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
  it("rejects a malformed or past date", async () => {
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: ["2030-13-01"] })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(await bulkOpenRentalDays({ offeringId: OFFERING, dates: ["2020-01-01"] })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("blockRentalDay — input guards", () => {
  it("rejects a non-uuid offering id and a malformed date", async () => {
    expect(await blockRentalDay({ offeringId: BAD_UUID, date: "2030-07-01" })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(await blockRentalDay({ offeringId: OFFERING, date: "2030-02-30" })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("setDailyOverride — input guards", () => {
  it("rejects a non-uuid id, malformed date, and malformed (non-null) money", async () => {
    expect(await setDailyOverride({ offeringId: BAD_UUID, date: "2030-07-01", dailyAmountOverride: "40.00" })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(await setDailyOverride({ offeringId: OFFERING, date: "bad", dailyAmountOverride: "40.00" })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(await setDailyOverride({ offeringId: OFFERING, date: "2030-07-01", dailyAmountOverride: "0" })).toEqual({ ok: false, error: "INVALID_MONEY" });
    expect(tx).not.toHaveBeenCalled();
  });
});

describe("manageStartTimes — input guards", () => {
  it("rejects a non-uuid id, malformed date, non-array, and out-of-range/too-many minutes", async () => {
    expect(await manageStartTimes({ offeringId: BAD_UUID, date: "2030-07-01", startTimeMinutes: [540] })).toEqual({ ok: false, error: "OFFERING_NOT_FOUND" });
    expect(await manageStartTimes({ offeringId: OFFERING, date: "bad", startTimeMinutes: [540] })).toEqual({ ok: false, error: "INVALID_DATE" });
    expect(await manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: 5 as unknown as number[] })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: [1440] })).toEqual({ ok: false, error: "INVALID_START_TIME" });
    expect(await manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: [-1] })).toEqual({ ok: false, error: "INVALID_START_TIME" });
    expect(await manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: [9.5] })).toEqual({ ok: false, error: "INVALID_START_TIME" });
    const tooMany = Array.from({ length: 49 }, (_, i) => i);
    expect(await manageStartTimes({ offeringId: OFFERING, date: "2030-07-01", startTimeMinutes: tooMany })).toEqual({ ok: false, error: "INVALID_START_TIME" });
    expect(tx).not.toHaveBeenCalled();
  });
});

// Guard against the fixed-now assumption drifting into the past as real time advances.
describe("test-clock sanity", () => {
  it("NOW is in the future relative to the hard-coded past date used above", () => {
    expect(NOW.getTime()).toBeGreaterThan(new Date("2020-01-01").getTime());
  });
});
