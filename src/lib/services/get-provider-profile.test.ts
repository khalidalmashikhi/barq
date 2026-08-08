import { describe, it, expect, vi, afterEach } from "vitest";

// Marketplace Completion — regression tests for getProviderProfile(),
// the query backing the new public provider storefront
// (/providers/[idOrSlug]). Mirrors get-service-detail.ts's own test
// conventions (mocked prisma, mocked getLocale).

vi.mock("server-only", () => ({}));

const findFirstMock = vi.fn();
const serviceCountMock = vi.fn();
const ratingAggregateMock = vi.fn();
const providerCategoryFindManyMock = vi.fn();
const mediaAssetFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    provider: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    service: {
      count: (...args: unknown[]) => serviceCountMock(...args),
    },
    rating: {
      aggregate: (...args: unknown[]) => ratingAggregateMock(...args),
    },
    providerCategory: {
      findMany: (...args: unknown[]) => providerCategoryFindManyMock(...args),
    },
    mediaAsset: {
      findMany: (...args: unknown[]) => mediaAssetFindManyMock(...args),
    },
  },
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const { getProviderProfile } = await import("./get-provider-profile");

afterEach(() => {
  findFirstMock.mockReset();
  serviceCountMock.mockReset();
  ratingAggregateMock.mockReset();
  providerCategoryFindManyMock.mockReset();
  mediaAssetFindManyMock.mockReset();
  getLocaleMock.mockReset();
});

const PROVIDER_UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

describe("getProviderProfile", () => {
  it("returns null when no matching APPROVED/visible provider exists", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await getProviderProfile("desert-trails");

    expect(result).toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { status: "APPROVED", visible: true, slug: "desert-trails" },
    });
  });

  it("looks up by id when the identifier is a valid UUID", async () => {
    findFirstMock.mockResolvedValue(null);

    await getProviderProfile(PROVIDER_UUID);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { status: "APPROVED", visible: true, id: PROVIDER_UUID },
    });
  });

  it("returns a full profile with aggregated rating when reviews exist", async () => {
    findFirstMock.mockResolvedValue({
      id: PROVIDER_UUID,
      businessName: { ar: "شركة", en: "Desert Trails" },
      businessDescription: { ar: "وصف", en: "A great provider" },
      status: "APPROVED",
      city: "Muscat",
      logoUrl: "https://example.com/logo.png",
    });
    getLocaleMock.mockResolvedValue("en");
    serviceCountMock.mockResolvedValue(4);
    ratingAggregateMock.mockResolvedValue({ _avg: { value: 4.5 }, _count: { value: 12 } });
    providerCategoryFindManyMock.mockResolvedValue([]);
    mediaAssetFindManyMock.mockResolvedValue([
      { id: "cov", url: "https://example.com/cover.jpg", kind: "COVER" },
      { id: "pf1", url: "https://example.com/p1.jpg", kind: "PORTFOLIO" },
    ]);

    const result = await getProviderProfile("desert-trails");

    expect(result).toEqual({
      id: PROVIDER_UUID,
      name: "Desert Trails",
      description: "A great provider",
      status: "APPROVED",
      city: "Muscat",
      logoUrl: "https://example.com/logo.png",
      coverUrl: "https://example.com/cover.jpg",
      portfolio: ["https://example.com/p1.jpg"],
      publishedServicesCount: 4,
      averageRating: 4.5,
      reviewCount: 12,
      categories: [],
    });
    expect(ratingAggregateMock).toHaveBeenCalledWith({
      where: { review: { providerId: PROVIDER_UUID, moderationState: "PUBLISHED" } },
      _avg: { value: true },
      _count: { value: true },
    });
  });

  it("returns a null averageRating and zero reviewCount when no reviews exist", async () => {
    findFirstMock.mockResolvedValue({
      id: PROVIDER_UUID,
      businessName: { ar: "شركة", en: "Desert Trails" },
      businessDescription: null,
      status: "APPROVED",
      city: null,
      logoUrl: null,
    });
    getLocaleMock.mockResolvedValue("en");
    serviceCountMock.mockResolvedValue(0);
    ratingAggregateMock.mockResolvedValue({ _avg: { value: null }, _count: { value: 0 } });
    providerCategoryFindManyMock.mockResolvedValue([]);
    mediaAssetFindManyMock.mockResolvedValue([]);

    const result = await getProviderProfile("desert-trails");

    expect(result?.averageRating).toBeNull();
    expect(result?.reviewCount).toBe(0);
    expect(result?.city).toBeNull();
    expect(result?.logoUrl).toBeNull();
    expect(result?.coverUrl).toBeNull();
    expect(result?.portfolio).toEqual([]);
  });
});
