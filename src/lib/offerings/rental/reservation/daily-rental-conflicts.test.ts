import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getDailyRentalVehicleConflicts, rentalConflictKey } from "./daily-rental-conflicts";

const NOW = new Date("2030-07-01T08:00:00.000Z");
const dbDate = (k: string) => new Date(`${k}T00:00:00.000Z`);

type Row = { vehicleId: string; serviceDate: Date; status: string; expiresAt: Date | null };
function makeDb(rows: Row[]) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rentalVehicleDayReservation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        calls.push(where);
        const w = where as { vehicleId: { in: string[] }; serviceDate: { gte: Date; lte: Date }; OR: { status: string; expiresAt?: { gt: Date } }[] };
        return rows.filter((r) =>
          w.vehicleId.in.includes(r.vehicleId) &&
          r.serviceDate >= w.serviceDate.gte && r.serviceDate <= w.serviceDate.lte &&
          w.OR.some((c) => c.status === r.status && (!c.expiresAt || (r.expiresAt !== null && r.expiresAt > c.expiresAt.gt))),
        ).map((r) => ({ vehicleId: r.vehicleId, serviceDate: r.serviceDate }));
      },
    },
  };
  return { db, calls };
}
const WIN = { from: "2030-07-10", to: "2030-07-20" };

describe("getDailyRentalVehicleConflicts", () => {
  it("returns CONFIRMED and unexpired-HELD conflicts; ignores expired-HELD/RELEASED/EXPIRED/CANCELLED", async () => {
    const { db } = makeDb([
      { vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "CONFIRMED", expiresAt: null },
      { vehicleId: "v1", serviceDate: dbDate("2030-07-12"), status: "HELD", expiresAt: new Date(NOW.getTime() + 600000) },
      { vehicleId: "v1", serviceDate: dbDate("2030-07-13"), status: "HELD", expiresAt: new Date(NOW.getTime() - 1000) }, // lapsed → ignored
      { vehicleId: "v1", serviceDate: dbDate("2030-07-14"), status: "RELEASED", expiresAt: null },
      { vehicleId: "v1", serviceDate: dbDate("2030-07-15"), status: "EXPIRED", expiresAt: null },
      { vehicleId: "v1", serviceDate: dbDate("2030-07-16"), status: "CANCELLED", expiresAt: null },
    ]);
    const set = await getDailyRentalVehicleConflicts(["v1"], WIN, db as never, NOW);
    expect([...set].sort()).toEqual([rentalConflictKey("v1", "2030-07-11"), rentalConflictKey("v1", "2030-07-12")].sort());
  });
  it("keys conflicts per (vehicle, day) and never crosses vehicles", async () => {
    const { db } = makeDb([
      { vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "CONFIRMED", expiresAt: null },
      { vehicleId: "v2", serviceDate: dbDate("2030-07-11"), status: "CONFIRMED", expiresAt: null },
    ]);
    const set = await getDailyRentalVehicleConflicts(["v1", "v2"], WIN, db as never, NOW);
    expect(set.has(rentalConflictKey("v1", "2030-07-11"))).toBe(true);
    expect(set.has(rentalConflictKey("v2", "2030-07-11"))).toBe(true);
    expect(set.has(rentalConflictKey("v1", "2030-07-12"))).toBe(false);
  });
  it("returns an empty set with NO query for an empty vehicle list", async () => {
    const { db, calls } = makeDb([{ vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "CONFIRMED", expiresAt: null }]);
    const set = await getDailyRentalVehicleConflicts([], WIN, db as never, NOW);
    expect(set.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it("returns empty for an inverted/invalid window", async () => {
    const { db } = makeDb([{ vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "CONFIRMED", expiresAt: null }]);
    expect((await getDailyRentalVehicleConflicts(["v1"], { from: "2030-07-20", to: "2030-07-10" }, db as never, NOW)).size).toBe(0);
  });
});
