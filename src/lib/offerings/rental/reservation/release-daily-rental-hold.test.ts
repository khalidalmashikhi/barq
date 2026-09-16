import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { releaseDailyRentalHold } from "./release-daily-rental-hold";

const NOW = new Date("2030-07-01T08:00:00.000Z");
type GroupRow = { id: string; customerId: string };
type ChildRow = { holdGroupId: string; status: string; releasedAt: Date | null };

function makeDb(groups: GroupRow[], children: ChildRow[]) {
  const audits: { action: string }[] = [];
  const match = (r: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => r[k] === v);
  const db = {
    rentalVehicleDayHoldGroup: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => groups.find((g) => match(g as unknown as Record<string, unknown>, where)) ?? null,
    },
    rentalVehicleDayReservation: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of children) if (match(r as unknown as Record<string, unknown>, where)) { Object.assign(r, data); count++; }
        return { count };
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data); return data; } },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db, children, audits };
}

describe("releaseDailyRentalHold", () => {
  it("releases every HELD child of the owner's group and audits once", async () => {
    const { db, children, audits } = makeDb(
      [{ id: "g1", customerId: "c1" }],
      [{ holdGroupId: "g1", status: "HELD", releasedAt: null }, { holdGroupId: "g1", status: "HELD", releasedAt: null }],
    );
    const res = await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW });
    expect(res).toEqual({ ok: true, releasedCount: 2 });
    expect(children.every((r) => r.status === "RELEASED" && r.releasedAt === NOW)).toBe(true);
    expect(audits).toHaveLength(1);
  });
  it("is idempotent — a repeat release is ok with releasedCount 0 and no extra audit", async () => {
    const { db, audits } = makeDb([{ id: "g1", customerId: "c1" }], [{ holdGroupId: "g1", status: "RELEASED", releasedAt: NOW }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW })).toEqual({ ok: true, releasedCount: 0 });
    expect(audits).toHaveLength(0);
  });
  it("never releases another customer's hold — foreign/missing group → NOT_FOUND (non-enumerating)", async () => {
    const { db, children } = makeDb([{ id: "g1", customerId: "c1" }], [{ holdGroupId: "g1", status: "HELD", releasedAt: null }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c2", now: NOW })).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(children[0]!.status).toBe("HELD"); // untouched
  });
  it("does NOT transition a CONFIRMED child (only HELD → RELEASED)", async () => {
    const { db, children } = makeDb([{ id: "g1", customerId: "c1" }], [{ holdGroupId: "g1", status: "CONFIRMED", releasedAt: null }]);
    expect(await releaseDailyRentalHold(db as never, { holdGroupId: "g1", customerId: "c1", now: NOW })).toEqual({ ok: true, releasedCount: 0 });
    expect(children[0]!.status).toBe("CONFIRMED");
  });
});
