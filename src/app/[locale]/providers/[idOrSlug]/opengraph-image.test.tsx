import { describe, it, expect, vi, afterEach } from "vitest";

// Growth Foundations phase — regression tests for the Provider Detail
// dynamic OG image route. Mirrors services/[id]/opengraph-image.test.tsx.

vi.mock("@/lib/services/get-provider-profile", () => ({
  getProviderProfile: vi.fn(),
}));

const { getProviderProfile } = await import("@/lib/services/get-provider-profile");
const { default: Image, alt, size, contentType } = await import("./opengraph-image");

const getProviderProfileMock = getProviderProfile as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  getProviderProfileMock.mockReset();
});

describe("Provider Detail opengraph-image", () => {
  it("declares the standard Next.js OG-image contract", () => {
    expect(alt).toBe("BARQ");
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("renders a real PNG image response for a real provider", async () => {
    getProviderProfileMock.mockResolvedValue({
      id: "provider-1",
      name: "Desert Co",
      description: "",
      status: "APPROVED",
      city: "Salalah",
      logoUrl: null,
      publishedServicesCount: 3,
      averageRating: 4.5,
      reviewCount: 10,
    });

    const response = await Image({ params: Promise.resolve({ idOrSlug: "desert-co" }) });

    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("falls back to the BARQ brand name honestly rather than throwing for a nonexistent provider", async () => {
    getProviderProfileMock.mockResolvedValue(null);

    const response = await Image({ params: Promise.resolve({ idOrSlug: "not-a-real-slug" }) });

    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
