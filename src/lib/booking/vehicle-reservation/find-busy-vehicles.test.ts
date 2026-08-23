import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { findBusyVehicleIdsForInterval } from "./find-busy-vehicles";

const START = new Date("2026-06-01T09:00:00.000Z");
const END = new Date("2026-06-01T12:00:00.000Z");

function makeDb(rows: Array<{ vehicleId: string }>) {
  const queryRaw = vi.fn((_sql: unknown) => {
    void _sql;
    return Promise.resolve(rows);
  });
  return { db: { $queryRaw: queryRaw } as never, queryRaw };
}

describe("findBusyVehicleIdsForInterval — BOOKING-CONFLICT-1C", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty set and runs NO query for empty input", async () => {
    const { db, queryRaw } = makeDb([]);
    const res = await findBusyVehicleIdsForInterval(db, [], START, END);
    expect(res.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("runs ONE bounded query and maps returned rows to a set of busy ids", async () => {
    const { db, queryRaw } = makeDb([{ vehicleId: "v1" }, { vehicleId: "v3" }]);
    const res = await findBusyVehicleIdsForInterval(db, ["v1", "v2", "v3"], START, END);

    expect([...res].sort()).toEqual(["v1", "v3"]);
    expect(queryRaw).toHaveBeenCalledTimes(1); // no N+1

    const sql = queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
    const text = sql.strings.join(" ");
    expect(text).toContain("vehicle_reservations");
    expect(text).toContain('"releasedAt" IS NULL');
    expect(text).toContain('"startsAt" <');
    expect(text).toContain('"endsAt" >');
    // Every candidate id + both interval bounds are BOUND parameters (never interpolated).
    expect(sql.values).toEqual(expect.arrayContaining(["v1", "v2", "v3", END, START]));
  });

  it("an all-free interval yields an empty set (query returned no rows)", async () => {
    const { db } = makeDb([]);
    const res = await findBusyVehicleIdsForInterval(db, ["v1", "v2"], START, END);
    expect(res.size).toBe(0);
  });
});
