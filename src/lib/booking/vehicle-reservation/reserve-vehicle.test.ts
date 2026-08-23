import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { Prisma } from "@prisma/client";
import { reserveVehicleForBooking } from "./reserve-vehicle";

const BOOKING = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const VEHICLE = "01a028ad-0000-7000-8000-000000000001";
const START = new Date("2026-06-01T09:00:00.000Z");
const END = new Date("2026-06-01T12:00:00.000Z");

// A mock transaction client that records the ORDER in which the primitive touches the DB
// (so we can prove lock → overlap-check → insert always runs in that sequence) and captures
// the SQL shape + bound params of each raw call for inspection.
function makeTx(over: { conflicts?: Array<{ id: string }>; createImpl?: () => Promise<{ id: string }> } = {}) {
  const calls: string[] = [];
  const captured = { lockParams: [] as unknown[], overlapSql: "", overlapParams: [] as unknown[] };
  const executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const isLock = strings.join("?").includes("pg_advisory_xact_lock");
    if (isLock) captured.lockParams = values;
    calls.push(isLock ? "lock" : "exec");
    return Promise.resolve(1);
  });
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.overlapSql = strings.join("?");
    captured.overlapParams = values;
    calls.push("overlap");
    return Promise.resolve(over.conflicts ?? []);
  });
  const create = vi.fn((args: unknown) => {
    void args;
    calls.push("insert");
    return over.createImpl ? over.createImpl() : Promise.resolve({ id: "res-1" });
  });
  const deleteMany = vi.fn();
  const bookingUpdate = vi.fn();
  const tx = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    vehicleReservation: { create, deleteMany },
    booking: { update: bookingUpdate },
  } as never;
  return { tx, calls, captured, executeRaw, queryRaw, create, deleteMany, bookingUpdate };
}

describe("reserveVehicleForBooking — BOOKING-CONFLICT-1A", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a malformed interval BEFORE any DB work (no lock, no query, no insert)", async () => {
    const m = makeTx();
    const res = await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: END, endsAt: START });
    expect(res).toEqual({ ok: false, reason: "INVALID_INTERVAL" });
    expect(m.executeRaw).not.toHaveBeenCalled();
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("acquires the per-vehicle advisory lock BEFORE the overlap check and BEFORE the insert", async () => {
    const m = makeTx({ conflicts: [] });
    await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(m.calls).toEqual(["lock", "overlap", "insert"]);
    // The lock key is derived from the vehicle id, passed as a bound parameter.
    expect(m.captured.lockParams).toEqual([VEHICLE]);
  });

  it("returns VEHICLE_BUSY and does NOT insert when an active reservation overlaps", async () => {
    const m = makeTx({ conflicts: [{ id: "existing" }] });
    const res = await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(res).toEqual({ ok: false, reason: "VEHICLE_BUSY" });
    expect(m.calls).toEqual(["lock", "overlap"]); // no insert
    expect(m.create).not.toHaveBeenCalled();
  });

  it("inserts and returns the new reservation id when the window is free", async () => {
    const m = makeTx({ conflicts: [], createImpl: () => Promise.resolve({ id: "res-xyz" }) });
    const res = await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(res).toEqual({ ok: true, reservationId: "res-xyz" });
    // The insert omits id (uuid(7) default) and carries exactly the reservation fields.
    expect(m.create).toHaveBeenCalledWith({
      data: { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END },
      select: { id: true },
    });
  });

  it("maps a bookingId unique violation (P2002) to ALREADY_RESERVED, not a throw", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["bookingId"] },
    });
    const m = makeTx({ conflicts: [], createImpl: () => Promise.reject(p2002) });
    const res = await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(res).toEqual({ ok: false, reason: "ALREADY_RESERVED" });
  });

  it("re-throws non-unique DB errors (does not swallow them)", async () => {
    const boom = new Error("connection reset");
    const m = makeTx({ conflicts: [], createImpl: () => Promise.reject(boom) });
    await expect(reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END })).rejects.toThrow("connection reset");
  });

  it("never mutates the booking or deletes rows (pure resource reservation)", async () => {
    const m = makeTx({ conflicts: [] });
    await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(m.bookingUpdate).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it("the overlap query filters to ACTIVE rows for the target vehicle", async () => {
    const m = makeTx({ conflicts: [] });
    await reserveVehicleForBooking(m.tx, { bookingId: BOOKING, vehicleId: VEHICLE, startsAt: START, endsAt: END });
    expect(m.captured.overlapSql).toContain("vehicle_reservations");
    expect(m.captured.overlapSql).toContain('"releasedAt" IS NULL');
    expect(m.captured.overlapSql).toContain('"startsAt" <');
    expect(m.captured.overlapSql).toContain('"endsAt" >');
    // Bound params: vehicleId, then the candidate end and start instants.
    expect(m.captured.overlapParams).toEqual([VEHICLE, END, START]);
  });
});
