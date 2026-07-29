import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — regression test for getPrices(),
// mirroring get-services.test.ts's shape.

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
    price: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getPrices } = await import("./get-prices");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getPrices", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "price-1",
        serviceId: "service-1",
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        amount: "25.00",
        currency: "OMR",
        status: "ACTIVE",
        createdAt: new Date(),
      },
    ]);

    const result = await getPrices();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ serviceName: "Desert Tour", amount: "25.00", status: "ACTIVE" }),
    ]);
  });

  it("filters by serviceId and status when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getPrices({ serviceId: "service-1", status: "SUPERSEDED" });

    expect(countMock).toHaveBeenCalledWith({ where: { serviceId: "service-1", status: "SUPERSEDED" } });
  });
});
