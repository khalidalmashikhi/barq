import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getAvailMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-availability", () => ({
  getProviderAvailability: (...a: unknown[]) => getAvailMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getAvailMock.mockReset());

describe("GET /api/v1/me/provider/availability", () => {
  it("200 maps slots (capacity + remainingSeats, NO bookedCount); state filter forwarded", async () => {
    getAvailMock.mockResolvedValue({
      items: [
        {
          id: "a1",
          serviceId: "s1",
          serviceName: "Safari",
          startTime: new Date("2026-06-01T09:00:00.000Z"),
          endTime: new Date("2026-06-01T12:00:00.000Z"),
          state: "OPEN",
          capacity: 5,
          bookedCount: 2,
          remainingSeats: 3,
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/availability?locale=en&state=OPEN"));
    expect(res.status).toBe(200);
    expect(getAvailMock).toHaveBeenCalledWith(expect.objectContaining({ state: "OPEN" }), "en");
    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: "a1",
      serviceId: "s1",
      serviceName: "Safari",
      startTime: "2026-06-01T09:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      state: "OPEN",
      capacity: 5,
      remainingSeats: 3,
    });
    expect(JSON.stringify(body)).not.toContain("bookedCount");
  });
});
