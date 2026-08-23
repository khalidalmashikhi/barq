import { describe, it, expect, vi, afterEach } from "vitest";

// BOOKING-SLOT-AUTHORITY — the ONE rule that decides whether a service must be
// booked against a slot.
//
// WHAT THESE TESTS EXIST TO PROVE is that the rule is DECLARATIVE, not momentary:
// a service stays slot-based when every slot is full, past or blocked. That is the
// entire point. `getAvailableSlots()` answers "what is bookable right now?", and if
// this ever collapsed into that question the ambiguity it was written to remove
// would come straight back — and with it the capacity-bypass path in createBooking.

vi.mock("server-only", () => ({}));

const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { availability: { count: (...args: unknown[]) => countMock(...args) } },
}));

const { serviceRequiresSlot } = await import("./service-requires-slot");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  countMock.mockReset();
});

describe("serviceRequiresSlot", () => {
  it("is false for a service with no availability rows at all", async () => {
    countMock.mockResolvedValue(0);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(false);
  });

  it("is true for a service with an OPEN slot", async () => {
    countMock.mockResolvedValue(1);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(true);
  });

  /**
   * THE CASE THAT MOTIVATED THIS FILE. A tour whose only slot was yesterday is still
   * a slot-based tour; `getAvailableSlots()` returns [] for it, and treating that as
   * "slotless" is exactly what let a booking skip the capacity guard.
   */
  it("is true when the only rows are in the past", async () => {
    countMock.mockResolvedValue(3);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(true);
  });

  it("is true when every slot is full", async () => {
    countMock.mockResolvedValue(2);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(true);
  });

  it("is true when the only rows are BLOCKED", async () => {
    countMock.mockResolvedValue(1);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(true);
  });

  /**
   * A CANCELLED slot is a WITHDRAWN offer, not a declaration — so a service whose
   * every row is cancelled has declared nothing and is bookable without a slot. This
   * is the only state excluded, and the query below is what enforces it.
   */
  it("excludes CANCELLED rows from the declaration", async () => {
    countMock.mockResolvedValue(0);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(false);
    expect(countMock).toHaveBeenCalledWith({
      where: { serviceId: SERVICE_ID, state: { not: "CANCELLED" } },
    });
  });

  /**
   * THE QUERY IS THE CONTRACT. It must not filter on `startTime`, `state: "OPEN"`, or
   * capacity — every one of those would silently turn this back into "currently
   * bookable" and reintroduce the ambiguity.
   */
  it("does not filter on time, OPEN-ness or remaining capacity", async () => {
    countMock.mockResolvedValue(1);

    await serviceRequiresSlot(SERVICE_ID);

    const where = (countMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(Object.keys(where).sort()).toEqual(["serviceId", "state"]);
    expect(where).not.toHaveProperty("startTime");
    expect(where).not.toHaveProperty("endTime");
    expect(where).not.toHaveProperty("bookedCount");
    expect(where).not.toHaveProperty("capacity");
    expect(where.state).toEqual({ not: "CANCELLED" });
  });

  /**
   * A service that cannot exist declares nothing. Callers already resolve the service
   * through their own authoritative gate first, so this never masks a real lookup —
   * and it must not hit the database.
   */
  it("is false for a malformed id, without querying", async () => {
    expect(await serviceRequiresSlot("not-a-uuid")).toBe(false);
    expect(await serviceRequiresSlot("")).toBe(false);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("treats any positive count as a declaration", async () => {
    countMock.mockResolvedValue(97);

    expect(await serviceRequiresSlot(SERVICE_ID)).toBe(true);
  });
});
