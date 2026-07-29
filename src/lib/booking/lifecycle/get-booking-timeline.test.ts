import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.1 — regression tests for getBookingTimeline: confirms
// chronological ordering, the DTO shape (occurredAt renamed from the
// raw createdAt column, actorId deliberately excluded), and that it
// queries strictly by bookingId.

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingStatusEvent: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getBookingTimeline } = await import("./get-booking-timeline");

afterEach(() => {
  findManyMock.mockReset();
});

describe("getBookingTimeline", () => {
  it("queries by bookingId, ordered oldest-first", async () => {
    findManyMock.mockResolvedValue([]);
    await getBookingTimeline("booking-1");

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "booking-1" },
        orderBy: { createdAt: "asc" },
      })
    );
  });

  it("maps createdAt to occurredAt and excludes actorId from the DTO", async () => {
    const createdAt = new Date("2026-07-20T10:00:00Z");
    findManyMock.mockResolvedValue([
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "CREATED",
        actorType: "CUSTOMER",
        reason: null,
        createdAt,
      },
    ]);

    const timeline = await getBookingTimeline("booking-1");

    expect(timeline).toEqual([
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "CREATED",
        actorType: "CUSTOMER",
        reason: null,
        occurredAt: createdAt,
      },
    ]);
    expect(timeline[0]).not.toHaveProperty("actorId");
  });

  it("preserves the chronological order returned by the query", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "CREATED",
        actorType: "CUSTOMER",
        reason: null,
        createdAt: new Date("2026-07-20T10:00:00Z"),
      },
      {
        id: "event-2",
        fromStatus: "CREATED",
        toStatus: "CONFIRMED",
        actorType: "PROVIDER",
        reason: null,
        createdAt: new Date("2026-07-20T11:00:00Z"),
      },
    ]);

    const timeline = await getBookingTimeline("booking-1");

    expect(timeline.map((entry) => entry.toStatus)).toEqual(["CREATED", "CONFIRMED"]);
  });
});
