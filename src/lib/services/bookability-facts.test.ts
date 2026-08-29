import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const availabilityFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { availability: { findMany: (...args: unknown[]) => availabilityFindManyMock(...args) } },
}));

const { getServiceSlotFacts } = await import("./bookability-facts");

const SVC_A = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const SVC_B = "019f4e4e-80b8-7cf2-b043-916c71648fcb";

describe("getServiceSlotFacts (batched)", () => {
  beforeEach(() => availabilityFindManyMock.mockReset());

  it("short-circuits with no queries for an empty / all-invalid id set", async () => {
    const facts = await getServiceSlotFacts(["not-a-uuid"]);
    expect(facts.requiresSlot.size).toBe(0);
    expect(facts.hasBookableSlot.size).toBe(0);
    expect(availabilityFindManyMock).not.toHaveBeenCalled();
  });

  it("classifies slot-based vs bookable with capacity applied in app code", async () => {
    availabilityFindManyMock
      // declared (non-CANCELLED) → both A and B are slot-based
      .mockResolvedValueOnce([{ serviceId: SVC_A }, { serviceId: SVC_B }])
      // OPEN future rows: A has a free seat; B's only open slot is full
      .mockResolvedValueOnce([
        { serviceId: SVC_A, capacity: 5, bookedCount: 2 },
        { serviceId: SVC_B, capacity: 4, bookedCount: 4 },
      ]);

    const facts = await getServiceSlotFacts([SVC_A, SVC_B]);
    expect(facts.requiresSlot.has(SVC_A)).toBe(true);
    expect(facts.requiresSlot.has(SVC_B)).toBe(true);
    expect(facts.hasBookableSlot.has(SVC_A)).toBe(true);
    // B has an OPEN future slot but it is full → NOT bookable.
    expect(facts.hasBookableSlot.has(SVC_B)).toBe(false);
  });

  it("treats a service with no availability rows as neither slot-based nor bookable", async () => {
    availabilityFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const facts = await getServiceSlotFacts([SVC_A]);
    expect(facts.requiresSlot.has(SVC_A)).toBe(false);
    expect(facts.hasBookableSlot.has(SVC_A)).toBe(false);
  });
});
