import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate mapping covered in src/lib/api/v1/provider-auth.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getServicesMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-services", () => ({
  getProviderServices: (...a: unknown[]) => getServicesMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getServicesMock.mockReset());

describe("GET /api/v1/me/provider/services", () => {
  it("200 maps DTOs (all statuses, money string), clamps pageSize, forwards locale + filters", async () => {
    getServicesMock.mockResolvedValue({
      items: [
        {
          id: "s1",
          name: "Safari",
          status: "DRAFT",
          price: "25 OMR",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          hasNoUpcomingAvailability: true,
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/services?locale=en&pageSize=100&status=DRAFT&sort=price_asc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 50, status: "DRAFT", sort: "price_asc" }),
      "en"
    );
    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: "s1",
      name: "Safari",
      status: "DRAFT",
      price: { amount: "25.00", currency: "OMR" },
      hasNoUpcomingAvailability: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(typeof body.items[0].price.amount).toBe("string");
  });

  it("ignores an invalid status filter (passes undefined)", async () => {
    getServicesMock.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 12, totalPages: 1 });
    await GET(new Request("http://x/api/v1/me/provider/services?status=BOGUS"));
    expect(getServicesMock).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }), "ar");
  });
});
