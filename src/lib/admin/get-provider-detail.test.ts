import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2 (Provider Foundation) — regression test for
// getProviderDetail(), mirroring get-category-detail.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

const { getProviderDetail } = await import("./get-provider-detail");

const PROVIDER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getProviderDetail", () => {
  it("returns null for a malformed id without querying the database", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });

    const result = await getProviderDetail("not-a-uuid");

    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null when the provider doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue(null);

    const result = await getProviderDetail(PROVIDER_ID);

    expect(result).toBeNull();
  });

  it("returns the provider detail", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    findUniqueMock.mockResolvedValue({
      id: PROVIDER_ID,
      userId: "user-1",
      businessName: { ar: "شركة", en: "Trips Co" },
      businessDescription: null,
      slug: "trips-co",
      status: "APPROVED",
      visible: true,
      contactEmail: "ops@trips.example",
      city: "Muscat",
      logoUrl: null,
      approvedAt: null,
      approvedByAdminId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getProviderDetail(PROVIDER_ID);

    expect(result).toEqual(
      expect.objectContaining({
        id: PROVIDER_ID,
        businessName: { ar: "شركة", en: "Trips Co" },
        slug: "trips-co",
        status: "APPROVED",
        visible: true,
        contactEmail: "ops@trips.example",
        city: "Muscat",
      })
    );
  });
});
