import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getProviderProfileMock = vi.fn();
vi.mock("@/lib/services/get-provider-profile", () => ({
  getProviderProfile: (...args: unknown[]) => getProviderProfileMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => getProviderProfileMock.mockReset());

const params = (idOrSlug: string) => ({ params: Promise.resolve({ idOrSlug }) });

describe("GET /api/v1/providers/{idOrSlug}", () => {
  it("404s when the provider is not APPROVED/visible (reader returns null)", async () => {
    getProviderProfileMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/v1/providers/hidden?locale=ar"), params("hidden"));

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    // default/ar locale message
    expect(body.error.message).toBe("المورد المطلوب غير موجود.");
  });

  it("200 maps the public DTO, forwards locale, and never exposes contactEmail/internal fields", async () => {
    getProviderProfileMock.mockResolvedValue({
      id: "p1",
      name: "Desert Co",
      description: "d",
      status: "APPROVED",
      providerType: "COMPANY",
      city: "Salalah",
      logoUrl: "https://cdn/logo.jpg",
      coverUrl: "https://cdn/cover.jpg",
      portfolio: ["https://cdn/1.jpg"],
      publishedServicesCount: 3,
      averageRating: 4.0,
      reviewCount: 5,
      categories: [{ id: "c1", slug: "tours", label: "Tours" }],
    });

    const res = await GET(new Request("http://localhost/api/v1/providers/desert-co?locale=en"), params("desert-co"));

    expect(res.status).toBe(200);
    expect(getProviderProfileMock).toHaveBeenCalledWith("desert-co", "en");
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.categories).toEqual([{ id: "c1", slug: "tours", label: "Tours" }]);
    expect(Object.keys(body)).not.toContain("contactEmail");
    expect(JSON.stringify(body)).not.toContain("contactEmail");
  });
});
