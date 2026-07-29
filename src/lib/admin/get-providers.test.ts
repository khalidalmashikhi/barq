import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2 (Provider Foundation) — regression test for getProviders(),
// mirroring get-categories.test.ts's shape.

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
    provider: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getProviders } = await import("./get-providers");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getProviders", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "provider-1",
        businessName: { ar: "شركة", en: "Trips Co" },
        slug: "trips-co",
        status: "APPROVED",
        visible: true,
        city: "Muscat",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await getProviders();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({ businessName: "Trips Co", status: "APPROVED" })]);
  });

  it("passes a search filter through to the where clause", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviders({ q: "trips" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { businessName: { path: ["ar"], string_contains: "trips" } },
          { businessName: { path: ["en"], string_contains: "trips" } },
        ],
      },
    });
  });

  it("filters by status when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getProviders({ status: "APPLIED" });

    expect(countMock).toHaveBeenCalledWith({ where: { status: "APPLIED" } });
  });
});
