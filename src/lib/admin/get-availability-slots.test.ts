import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.7 (Availability Foundation) — regression test for
// getAvailabilitySlots(), mirroring get-services.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    availability: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getAvailabilitySlots } = await import("./get-availability-slots");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getAvailabilitySlots", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "slot-1",
        serviceId: "service-1",
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        startTime: new Date(),
        endTime: new Date(),
        state: "OPEN",
        capacity: 10,
        bookedCount: 4,
      },
    ]);

    const result = await getAvailabilitySlots();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ serviceName: "Desert Tour", state: "OPEN", remainingSeats: 6 }),
    ]);
  });

  it("returns an empty result for a malformed serviceId without querying", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getAvailabilitySlots({ serviceId: "not-a-uuid" });

    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(countMock).not.toHaveBeenCalled();
  });

  it("filters by state and serviceId when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    const serviceId = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
    await getAvailabilitySlots({ state: "BLOCKED", serviceId });

    expect(countMock).toHaveBeenCalledWith({ where: { serviceId, state: "BLOCKED" } });
  });
});
