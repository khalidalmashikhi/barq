import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { releaseDailyRentalHold } from "./release-daily-rental-hold";

const NOW = new Date("2030-07-01T08:00:00.000Z");
type Row = { holdGroupId: string; customerId: string; status: string; releasedAt: Date | null };
function makeDb(rows: Row[]) {
  const audits: { action: string }[] = [];
  const match = (r: Row, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const db = {
    rentalVehicleDayReservation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of rows) if (match(r, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data); return data; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, rows, audits };
}

describe("releaseDailyRentalHold", () => {
  it("releases every HELD row of the owner's group and audits once", async () => {
    const { db, rows, audits } = makeDb([
      { holdGroupId: "g1", customerId: "c1", status: "HELD", releasedAt: null },
      { holdGroupId: "g1", customerId: "c1", status: "HELD", releasedAt: null },
    ]);
    const res = await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW });
    expect(res).toEqual({ ok: true, releasedCount: 2 });
    expect(rows.every((r) => r.status === "RELEASED" && r.releasedAt === NOW)).toBe(true);
    expect(audits).toHaveLength(1);
  });
  it("is idempotent — a repeat release is ok with releasedCount 0 and no extra audit", async () => {
    const { db, audits } = makeDb([{ holdGroupId: "g1", customerId: "c1", status: "RELEASED", releasedAt: NOW }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW })).toEqual({ ok: true, releasedCount: 0 });
    expect(audits).toHaveLength(0);
  });
  it("never releases another customer's hold — foreign/missing group → NOT_FOUND (non-enumerating)", async () => {
    const { db, rows } = makeDb([{ holdGroupId: "g1", customerId: "c1", status: "HELD", releasedAt: null }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c2", now: NOW })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(rows[0]!.status).toBe("HELD"); // untouched
  });
  it("does NOT transition a CONFIRMED row (only HELD → RELEASED)", async () => {
    const { db, rows } = makeDb([{ holdGroupId: "g1", customerId: "c1", status: "CONFIRMED", releasedAt: null }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW })).toEqual({ ok: true, releasedCount: 0 });
    expect(rows[0]!.status).toBe("CONFIRMED");
  });
});
