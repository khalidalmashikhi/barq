import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.2 — regression tests for getContractHistory(), mirroring
// src/lib/booking/lifecycle/get-booking-timeline.test.ts's approach.

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    bookingContractEvent: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getContractHistory } = await import("./get-contract-history");

afterEach(() => {
  findManyMock.mockReset();
});

describe("getContractHistory", () => {
  it("queries by contractId, ordered oldest-first", async () => {
    findManyMock.mockResolvedValue([]);
    await getContractHistory("contract-1");

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contractId: "contract-1" }, orderBy: { createdAt: "asc" } })
    );
  });

  it("maps createdAt to occurredAt and excludes actorId", async () => {
    const createdAt = new Date("2026-07-20T10:00:00Z");
    findManyMock.mockResolvedValue([
      { id: "event-1", eventType: "CREATED", actorType: "PROVIDER", note: null, createdAt },
    ]);

    const history = await getContractHistory("contract-1");

    expect(history).toEqual([
      { id: "event-1", eventType: "CREATED", actorType: "PROVIDER", note: null, occurredAt: createdAt },
    ]);
    expect(history[0]).not.toHaveProperty("actorId");
  });

  it("preserves the chronological order of the underlying query", async () => {
    findManyMock.mockResolvedValue([
      { id: "e1", eventType: "CREATED", actorType: "PROVIDER", note: null, createdAt: new Date("2026-07-20T10:00:00Z") },
      { id: "e2", eventType: "GENERATED", actorType: "PROVIDER", note: null, createdAt: new Date("2026-07-20T11:00:00Z") },
      { id: "e3", eventType: "DOWNLOADED", actorType: "CUSTOMER", note: null, createdAt: new Date("2026-07-20T12:00:00Z") },
    ]);

    const history = await getContractHistory("contract-1");
    expect(history.map((entry) => entry.eventType)).toEqual(["CREATED", "GENERATED", "DOWNLOADED"]);
  });
});
