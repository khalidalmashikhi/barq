import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { expireStaleDailyRentalHolds, expireStaleHoldsForVehicleDates } from "./expire-stale-daily-rental-holds";

const NOW = new Date("2030-07-01T08:00:00.000Z");
const dbDate = (k: string) => new Date(`${k}T00:00:00.000Z`);
type Row = { id: string; vehicleId: string; serviceDate: Date; status: string; expiresAt: Date | null };

function makeDb(rows: Row[]) {
  const match = (r: Row, w: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(w)) {
      if (k === "status") { if (r.status !== v) return false; continue; }
      if (k === "expiresAt") { const f = v as { lte?: Date }; if (f.lte && !(r.expiresAt && r.expiresAt <= f.lte)) return false; continue; }
      if (k === "id") { if (!(v as { in: string[] }).in.includes(r.id)) return false; continue; }
      if (k === "vehicleId") { if (r.vehicleId !== v) return false; continue; }
      if (k === "serviceDate") { if (!(v as { in: Date[] }).in.some((d) => d.getTime() === r.serviceDate.getTime())) return false; continue; }
    }
    return true;
  };
  const db = {
    rentalVehicleDayReservation: {
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => rows.filter((r) => match(r, where)).slice(0, take).map((r) => ({ id: r.id })),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of rows) if (match(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
  };
  return { db, rows };
}

describe("expireStaleDailyRentalHolds (general bounded sweep)", () => {
  it("transitions ONLY lapsed HELD rows to EXPIRED; never touches CONFIRMED or future HELD", async () => {
    const { db, rows } = makeDb([
      { id: "a", vehicleId: "v1", serviceDate: dbDate("2030-07-10"), status: "HELD", expiresAt: new Date(NOW.getTime() - 1000) },
      { id: "b", vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "HELD", expiresAt: new Date(NOW.getTime() + 1000) },
      { id: "c", vehicleId: "v1", serviceDate: dbDate("2030-07-12"), status: "CONFIRMED", expiresAt: null },
    ]);
    expect(await expireStaleDailyRentalHolds(db as never, { now: NOW })).toEqual({ expired: 1 });
    expect(rows.find((r) => r.id === "a")!.status).toBe("EXPIRED");
    expect(rows.find((r) => r.id === "b")!.status).toBe("HELD");
    expect(rows.find((r) => r.id === "c")!.status).toBe("CONFIRMED");
  });
  it("is a no-op (expired 0) when nothing is stale", async () => {
    const { db } = makeDb([{ id: "b", vehicleId: "v1", serviceDate: dbDate("2030-07-11"), status: "HELD", expiresAt: new Date(NOW.getTime() + 1000) }]);
    expect(await expireStaleDailyRentalHolds(db as never, { now: NOW })).toEqual({ expired: 0 });
  });
});

describe("expireStaleHoldsForVehicleDates (targeted)", () => {
  it("expires only the lapsed HELD rows for the given vehicle + dates", async () => {
    const { db, rows } = makeDb([
      { id: "a", vehicleId: "v1", serviceDate: dbDate("2030-07-10"), status: "HELD", expiresAt: new Date(NOW.getTime() - 1000) },
      { id: "d", vehicleId: "v2", serviceDate: dbDate("2030-07-10"), status: "HELD", expiresAt: new Date(NOW.getTime() - 1000) },
    ]);
    const res = await expireStaleHoldsForVehicleDates(db as never, "v1", [dbDate("2030-07-10")], NOW);
    expect(res).toEqual({ expired: 1 });
    expect(rows.find((r) => r.id === "a")!.status).toBe("EXPIRED");
    expect(rows.find((r) => r.id === "d")!.status).toBe("HELD"); // other vehicle untouched
  });
  it("no-ops for an empty date set", async () => {
    const { db } = makeDb([{ id: "a", vehicleId: "v1", serviceDate: dbDate("2030-07-10"), status: "HELD", expiresAt: new Date(NOW.getTime() - 1000) }]);
    expect(await expireStaleHoldsForVehicleDates(db as never, "v1", [], NOW)).toEqual({ expired: 0 });
  });
});
