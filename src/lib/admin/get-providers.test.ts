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
        userId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9",
        user: { phoneNumber: "+96890000002" },
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
    expect(result.items).toEqual([
      expect.objectContaining({ businessName: "Trips Co", status: "APPROVED", phoneNumber: "+96890000002" }),
    ]);
  });

  it("searches businessName and phone for a non-UUID query (no userId clause)", async () => {
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
          { user: { phoneNumber: { contains: "trips" } } },
        ],
      },
    });
  });

  it("adds an exact User ID clause when the query is a valid UUID", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    const uuid = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
    await getProviders({ q: uuid });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { businessName: { path: ["ar"], string_contains: uuid } },
          { businessName: { path: ["en"], string_contains: uuid } },
          { user: { phoneNumber: { contains: uuid } } },
          { userId: uuid },
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
