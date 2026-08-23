import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { releaseVehicleReservationForBooking } from "./release-vehicle-reservation";

const BOOKING = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const AT = new Date("2026-06-01T13:00:00.000Z");

function makeTx(count: number) {
  const updateMany = vi.fn((args: { where: unknown; data: unknown }) => {
    void args;
    return Promise.resolve({ count });
  });
  const deleteMany = vi.fn();
  const tx = { vehicleReservation: { updateMany, deleteMany } } as never;
  return { tx, updateMany, deleteMany };
}

describe("releaseVehicleReservationForBooking — BOOKING-CONFLICT-1A", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps releasedAt on the active reservation and reports it released", async () => {
    const m = makeTx(1);
    const res = await releaseVehicleReservationForBooking(m.tx, BOOKING, AT);
    expect(res).toEqual({ released: 1 });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING, releasedAt: null },
      data: { releasedAt: AT },
    });
  });

  it("is idempotent: releasing when nothing is active returns { released: 0 }", async () => {
    const m = makeTx(0);
    const res = await releaseVehicleReservationForBooking(m.tx, BOOKING, AT);
    expect(res).toEqual({ released: 0 });
  });

  it("only targets active rows (releasedAt: null) — never re-releases an already-released one", async () => {
    const m = makeTx(0);
    await releaseVehicleReservationForBooking(m.tx, BOOKING, AT);
    expect(m.updateMany.mock.calls[0]![0]).toMatchObject({ where: { releasedAt: null } });
  });

  it("releases by stamping — it never deletes reservation history", async () => {
    const m = makeTx(1);
    await releaseVehicleReservationForBooking(m.tx, BOOKING, AT);
    expect(m.deleteMany).not.toHaveBeenCalled();
  });
});
