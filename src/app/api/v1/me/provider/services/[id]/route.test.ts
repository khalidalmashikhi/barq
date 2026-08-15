import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getDetailMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-service-detail", () => ({
  getProviderServiceDetail: (...a: unknown[]) => getDetailMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getDetailMock.mockReset());
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/me/provider/services/{id}", () => {
  it("404 uniform for invalid/missing/not-owned (reader null)", async () => {
    getDetailMock.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/v1/me/provider/services/x?locale=en"), params("x"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("200 maps detail; ownership scoping delegated to the reader (id + locale forwarded)", async () => {
    getDetailMock.mockResolvedValue({
      id: "s1",
      name: "Safari",
      description: "d",
      status: "PUBLISHED",
      price: "25 OMR",
      priceAmount: "25",
      priceCurrency: "OMR",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/services/s1?locale=en"), params("s1"));
    expect(res.status).toBe(200);
    expect(getDetailMock).toHaveBeenCalledWith("s1", "en");
    const body = await res.json();
    expect(body.price).toEqual({ amount: "25.00", currency: "OMR" });
    expect(body.status).toBe("PUBLISHED");
  });
});
