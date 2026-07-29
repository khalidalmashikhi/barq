import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.3 (Service Foundation) — regression test for getServices(),
// mirroring get-providers.test.ts's shape.

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
    service: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getServices } = await import("./get-services");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getServices", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "service-1",
        name: { ar: "جولة", en: "Desert Tour" },
        providerId: "provider-1",
        provider: { businessName: { ar: "شركة", en: "Trips Co" } },
        status: "DRAFT",
        prices: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await getServices();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ name: "Desert Tour", providerName: "Trips Co", status: "DRAFT", activePrice: null }),
    ]);
  });

  it("passes a search filter through to the where clause", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ q: "desert" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { path: ["ar"], string_contains: "desert" } },
          { name: { path: ["en"], string_contains: "desert" } },
        ],
      },
    });
  });

  it("filters by status and providerId when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getServices({ status: "PUBLISHED", providerId: "provider-1" });

    expect(countMock).toHaveBeenCalledWith({ where: { status: "PUBLISHED", providerId: "provider-1" } });
  });
});
