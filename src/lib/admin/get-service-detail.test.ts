import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.3 (Service Foundation) — regression test for getServiceDetail(),
// mirroring get-provider-detail.test.ts's shape.

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
    service: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getServiceDetail } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getServiceDetail", () => {
  it("requires an Admin and returns null for a malformed id without querying", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getServiceDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the service doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue(null);

    const result = await getServiceDetail(SERVICE_ID);

    expect(result).toBeNull();
  });

  it("returns the raw bilingual name/description alongside a locale-extracted providerName", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    findUniqueMock.mockResolvedValue({
      id: SERVICE_ID,
      providerId: "provider-1",
      provider: { businessName: { ar: "شركة", en: "Trips Co" } },
      serviceType: "EXPERIENCE",
      name: { ar: "جولة", en: "Desert Tour" },
      description: null,
      status: "DRAFT",
      prices: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getServiceDetail(SERVICE_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: SERVICE_ID,
        providerId: "provider-1",
        providerName: "Trips Co",
        serviceType: "EXPERIENCE",
        name: { ar: "جولة", en: "Desert Tour" },
        description: null,
        status: "DRAFT",
        activePrice: null,
      })
    );
  });
});
