import { describe, it, expect, vi, afterEach } from "vitest";

// BOOKING-SLOT-AUTHORITY (approved hardening) — pins the EXISTING semantics of
// getAvailableSlots(), which this gate deliberately does NOT change.
//
// WHY THIS FILE EXISTS. `serviceRequiresSlot()` and `getAvailableSlots()` answer two
// different questions and were, until this gate, conflated:
//
//   getAvailableSlots()   what can be booked RIGHT NOW  (OPEN + future + seats left)
//   serviceRequiresSlot() whether the service is slot-based AT ALL  (any non-CANCELLED row)
//
// Pinning this reader separately is what keeps them from drifting back together. If a
// later change makes this one declarative, or makes the other one momentary, one of
// these two files fails immediately rather than the ambiguity quietly returning.
//
// The query itself is the boundary: state/time are filtered in SQL, and "full" is
// filtered in application code only because Prisma cannot compare two columns — a
// limitation the reader's own comment documents. This is a display list; the real
// capacity guard is the atomic UPDATE in createBooking(), never this.

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { availability: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

const { getAvailableSlots } = await import("./get-available-slots");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function slot(over: Partial<{ id: string; capacity: number; bookedCount: number }> = {}) {
  return {
    id: over.id ?? "slot-1",
    startTime: new Date("2026-09-01T10:00:00.000Z"),
    endTime: new Date("2026-09-01T13:00:00.000Z"),
    capacity: over.capacity ?? 5,
    bookedCount: over.bookedCount ?? 0,
  };
}

afterEach(() => {
  findManyMock.mockReset();
});

describe("getAvailableSlots", () => {
  // --- the query: state and time are the database's job ---------------------

  /**
   * OPEN AND FUTURE ONLY, filtered in SQL. BLOCKED and CANCELLED never reach the
   * mapper at all, which is why no test below needs to strip them.
   */
  it("asks the database for OPEN, future slots only, ordered by start time", async () => {
    findManyMock.mockResolvedValue([]);

    await getAvailableSlots(SERVICE_ID);

    const arg = findManyMock.mock.calls[0]![0] as {
      where: { serviceId: string; state: string; startTime: { gt: Date } };
      orderBy: unknown;
    };
    expect(arg.where.serviceId).toBe(SERVICE_ID);
    expect(arg.where.state).toBe("OPEN");
    expect(arg.where.startTime.gt).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual({ startTime: "asc" });
  });

  it("never widens the query to BLOCKED or CANCELLED", async () => {
    findManyMock.mockResolvedValue([]);

    await getAvailableSlots(SERVICE_ID);

    const where = (findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    // A single equality on OPEN — not an `in` list, not a `not` exclusion, either of
    // which would let a blocked or cancelled slot be offered for booking.
    expect(where.state).toBe("OPEN");
  });

  // --- capacity: filtered in application code, deliberately -----------------

  it("drops slots with no remaining seats", async () => {
    findManyMock.mockResolvedValue([
      slot({ id: "full", capacity: 4, bookedCount: 4 }),
      slot({ id: "open", capacity: 4, bookedCount: 1 }),
    ]);

    const slots = await getAvailableSlots(SERVICE_ID);

    expect(slots.map((s) => s.id)).toEqual(["open"]);
  });

  /** Over-booked rows (a repaired race) must not surface as negative availability. */
  it("drops a slot booked beyond its capacity rather than reporting negative seats", async () => {
    findManyMock.mockResolvedValue([slot({ id: "over", capacity: 2, bookedCount: 5 })]);

    expect(await getAvailableSlots(SERVICE_ID)).toEqual([]);
  });

  it("reports remainingSeats as capacity minus bookedCount", async () => {
    findManyMock.mockResolvedValue([slot({ capacity: 5, bookedCount: 2 })]);

    const [only] = await getAvailableSlots(SERVICE_ID);

    expect(only!.remainingSeats).toBe(3);
  });

  // --- shape ----------------------------------------------------------------

  /** An allow-list: capacity and bookedCount are internal and must not leak out. */
  it("exposes only id, startTime, endTime and remainingSeats", async () => {
    findManyMock.mockResolvedValue([slot()]);

    const [only] = await getAvailableSlots(SERVICE_ID);

    expect(Object.keys(only!).sort()).toEqual(["endTime", "id", "remainingSeats", "startTime"]);
  });

  it("preserves the database ordering rather than re-sorting", async () => {
    findManyMock.mockResolvedValue([
      slot({ id: "a", bookedCount: 0 }),
      slot({ id: "b", bookedCount: 1 }),
      slot({ id: "c", bookedCount: 2 }),
    ]);

    expect((await getAvailableSlots(SERVICE_ID)).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for a service with nothing bookable", async () => {
    findManyMock.mockResolvedValue([]);

    expect(await getAvailableSlots(SERVICE_ID)).toEqual([]);
  });

  it("returns an empty list for a malformed id, without querying", async () => {
    expect(await getAvailableSlots("not-a-uuid")).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  /**
   * THE DISTINCTION THIS GATE DEPENDS ON, stated as a test. An empty list here says
   * NOTHING about whether the service is slot-based — that is serviceRequiresSlot()'s
   * job, and conflating them is precisely the bug BOOKING-SLOT-AUTHORITY closes.
   */
  it("an empty result does not mean the service is slotless", async () => {
    findManyMock.mockResolvedValue([slot({ capacity: 1, bookedCount: 1 })]);

    // One real, declared slot exists — it is simply full.
    expect(await getAvailableSlots(SERVICE_ID)).toEqual([]);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
