import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cancelConfirmedDailyRentalReservations } from "./cancel-confirmed-daily-rental-reservations";

const NOW = new Date("2030-07-01T08:00:00.000Z");
type Row = { holdGroupId: string; status: string; releasedAt: Date | null };

function makeDb(groups: { id: string; bookingId: string | null }[], rows: Row[]) {
  const db = {
    rentalVehicleDayHoldGroup: {
      findMany: async ({ where }: { where: { bookingId: string } }) => groups.filter((g) => g.bookingId === where.bookingId).map((g) => ({ id: g.id })),
    },
    rentalVehicleDayReservation: {
      updateMany: async ({ where, data }: { where: { holdGroupId: { in: string[] }; status: string }; data: { status: string; releasedAt: Date } }) => {
        let count = 0;
        for (const r of rows) if (where.holdGroupId.in.includes(r.holdGroupId) && r.status === where.status) { r.status = data.status; r.releasedAt = data.releasedAt; count++; }
        return { count };
      },
    },
  };
  return { db, rows };
}

describe("cancelConfirmedDailyRentalReservations", () => {
  it("transitions all CONFIRMED children of the booking's group(s) → CANCELLED (releasedAt set)", async () => {
    const { db, rows } = makeDb(
      [{ id: "g1", bookingId: "bk-1" }],
      [{ holdGroupId: "g1", status: "CONFIRMED", releasedAt: null }, { holdGroupId: "g1", status: "CONFIRMED", releasedAt: null }],
    );
    expect(await cancelConfirmedDailyRentalReservations(db as never, "bk-1", NOW)).toEqual({ cancelled: 2 });
    expect(rows.every((r) => r.status === "CANCELLED" && r.releasedAt === NOW)).toBe(true);
  });
  it("is an idempotent no-op for a non-rental booking (no linked groups)", async () => {
    const { db } = makeDb([], [{ holdGroupId: "g1", status: "CONFIRMED", releasedAt: null }]);
    expect(await cancelConfirmedDailyRentalReservations(db as never, "legacy-bk", NOW)).toEqual({ cancelled: 0 });
  });
  it("never touches HELD rows (an unconfirmed hold is not linked to a booking)", async () => {
    const { db, rows } = makeDb([{ id: "g1", bookingId: "bk-1" }], [{ holdGroupId: "g1", status: "HELD", releasedAt: null }]);
    expect(await cancelConfirmedDailyRentalReservations(db as never, "bk-1", NOW)).toEqual({ cancelled: 0 });
    expect(rows[0]!.status).toBe("HELD");
  });
  it("is scoped to the booking's own groups (another booking's rows untouched)", async () => {
    const { db, rows } = makeDb(
      [{ id: "g1", bookingId: "bk-1" }, { id: "g2", bookingId: "bk-2" }],
      [{ holdGroupId: "g1", status: "CONFIRMED", releasedAt: null }, { holdGroupId: "g2", status: "CONFIRMED", releasedAt: null }],
    );
    await cancelConfirmedDailyRentalReservations(db as never, "bk-1", NOW);
    expect(rows.find((r) => r.holdGroupId === "g1")!.status).toBe("CANCELLED");
    expect(rows.find((r) => r.holdGroupId === "g2")!.status).toBe("CONFIRMED");
  });
});
