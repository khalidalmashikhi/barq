import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.7 (Availability Foundation) — regression test for
// getAvailabilitySlotDetail(), mirroring get-service-detail.test.ts's
// shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    availability: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getAvailabilitySlotDetail } = await import("./get-availability-slot-detail");

const SLOT_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getAvailabilitySlotDetail", () => {
  it("requires an Admin and returns null for a malformed id without querying", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getAvailabilitySlotDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the slot doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue(null);

    const result = await getAvailabilitySlotDetail(SLOT_ID);

    expect(result).toBeNull();
  });

  it("returns the slot detail with a locale-extracted serviceName and a defensive remainingSeats", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: SLOT_ID,
      serviceId: "service-1",
      service: { name: { ar: "جولة", en: "Desert Tour" } },
      startTime: new Date(),
      endTime: new Date(),
      state: "OPEN",
      capacity: 5,
      bookedCount: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getAvailabilitySlotDetail(SLOT_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: SLOT_ID,
        serviceId: "service-1",
        serviceName: "Desert Tour",
        state: "OPEN",
        capacity: 5,
        bookedCount: 7,
        remainingSeats: 0,
      })
    );
  });
});
