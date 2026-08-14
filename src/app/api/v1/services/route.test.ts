import { describe, it, expect, vi, afterEach } from "vitest";

// Route test: mock the tracing wrapper (passthrough) and the authoritative
// getServices() reader (its publication + provider APPROVED/visible gate is
// already covered by src/lib/services/get-services.test.ts). This asserts the
// thin HTTP/DTO adapter: locale pass-through, pageSize clamp, DTO mapping,
// MoneyDTO amount-as-string, and no-store.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getServicesMock = vi.fn();
vi.mock("@/lib/services/get-services", () => ({
  getServices: (...args: unknown[]) => getServicesMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => getServicesMock.mockReset());

describe("GET /api/v1/services", () => {
  it("passes the resolved locale + clamped pageSize to getServices and maps DTOs", async () => {
    getServicesMock.mockResolvedValue({
      items: [
        {
          id: "s1",
          name: "Desert Safari",
          providerId: "p1",
          providerName: "Desert Co",
          price: "25 OMR",
          regionCode: "DHOFAR",
          pricingUnit: "PER_PERSON",
          coverUrl: "https://cdn/c.jpg",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    const res = await GET(new Request("http://localhost/api/v1/services?locale=en&pageSize=100&sort=price_asc"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    // Locale resolved to "en"; pageSize clamped 100 → 50; sort forwarded.
    expect(getServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 50, sort: "price_asc" }),
      "en"
    );

    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: "s1",
      name: "Desert Safari",
      providerId: "p1",
      providerName: "Desert Co",
      price: { amount: "25.00", currency: "OMR" },
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      coverUrl: "https://cdn/c.jpg",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(typeof body.items[0].price.amount).toBe("string");
    expect(body).toMatchObject({ page: 1, pageSize: 50, totalCount: 1, totalPages: 1 });
  });

  it("defaults locale to ar and pageSize to the domain default (12) when unspecified", async () => {
    getServicesMock.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 1 });

    await GET(new Request("http://localhost/api/v1/services"));

    expect(getServicesMock).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 12 }), "ar");
  });
});
