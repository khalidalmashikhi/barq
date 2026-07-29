import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.5 (Pricing Foundation) — regression test for getPriceDetail(),
// mirroring get-service-detail.test.ts's shape.

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
    price: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getPriceDetail } = await import("./get-price-detail");

const PRICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getPriceDetail", () => {
  it("requires an Admin and returns null for a malformed id without querying", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getPriceDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the price doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue(null);

    const result = await getPriceDetail(PRICE_ID);

    expect(result).toBeNull();
  });

  it("returns the price detail with a locale-extracted serviceName", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: PRICE_ID,
      serviceId: "service-1",
      service: { name: { ar: "جولة", en: "Desert Tour" } },
      amount: "25.00",
      currency: "OMR",
      status: "ACTIVE",
      createdAt: new Date(),
    });

    const result = await getPriceDetail(PRICE_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: PRICE_ID,
        serviceId: "service-1",
        serviceName: "Desert Tour",
        amount: "25.00",
        currency: "OMR",
        status: "ACTIVE",
      })
    );
  });
});
